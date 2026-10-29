/**
 * Autenticació de les peticions:
 * - requireAdmin: usuaris del backoffice (Authorization: Bearer <token admin>)
 * - requireTerminal: terminals vinculats (X-Terminal-Token)
 * - requireOperator: operador amb sessió en aquell terminal (Authorization: Bearer <token operador>);
 *   sempre després de requireTerminal.
 */
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { DomainError, unauthorized } from '../common/errors';
import { sha256 } from '../common/crypto';
import { verifyJwt } from '../common/jwt';
import { adminUsers, events, operators, pointsOfSale, roleAssignments, terminals } from '../db/schema';
import type { AdminTokenPayload, OperatorTokenPayload } from '../auth/principals';
import type { AppDeps, AppEnv } from './context';

export const TERMINAL_TOKEN_HEADER = 'x-terminal-token';
const LAST_SEEN_THROTTLE_MS = 30_000;

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export function authMiddleware(deps: AppDeps) {
  const { db, config } = deps;

  const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    if (!token) throw unauthorized();
    const payload = verifyJwt<AdminTokenPayload>(token, config.jwtSecret);
    if (!payload) throw unauthorized('La sessió ha caducat');
    if (payload.kind !== 'admin') throw unauthorized();

    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, payload.sub)).limit(1);
    if (!user?.active) throw unauthorized();
    const roles = await db
      .select({ role: roleAssignments.role, organizationId: roleAssignments.organizationId, eventId: roleAssignments.eventId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, user.id));
    c.set('admin', { id: user.id, email: user.email, name: user.name, roles });
    await next();
  });

  const requireTerminal = createMiddleware<AppEnv>(async (c, next) => {
    const token = c.req.header(TERMINAL_TOKEN_HEADER);
    if (!token) throw unauthorized('Terminal no vinculat');

    const [row] = await db
      .select({ terminal: terminals, pos: pointsOfSale, organizationId: events.organizationId })
      .from(terminals)
      .innerJoin(pointsOfSale, eq(pointsOfSale.id, terminals.pointOfSaleId))
      .innerJoin(events, eq(events.id, terminals.eventId))
      .where(eq(terminals.tokenHash, sha256(token)))
      .limit(1);
    if (!row) throw unauthorized('Terminal no vinculat');
    if (!row.terminal.active || !row.pos.active) {
      throw new DomainError('TERMINAL_DISABLED', 'Aquest terminal està desactivat', 403);
    }

    c.set('terminal', {
      id: row.terminal.id,
      name: row.terminal.name,
      eventId: row.terminal.eventId,
      organizationId: row.organizationId,
      pointOfSaleId: row.pos.id,
      posKind: row.pos.kind,
      vendorId: row.pos.vendorId,
    });

    const lastSeen = row.terminal.lastSeenAt?.getTime() ?? 0;
    if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      await db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, row.terminal.id));
    }
    await next();
  });

  const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
    const terminal = c.get('terminal');
    if (!terminal) throw unauthorized('Terminal no vinculat');
    const token = bearer(c.req.header('authorization'));
    if (!token) throw unauthorized('Cal entrar amb el PIN');
    const payload = verifyJwt<OperatorTokenPayload>(token, config.jwtSecret);
    if (!payload) throw unauthorized('La sessió ha caducat: torna a entrar amb el PIN');
    if (payload.kind !== 'operator' || payload.terminalId !== terminal.id) throw unauthorized('Cal entrar amb el PIN');

    const [operator] = await db
      .select()
      .from(operators)
      .where(and(eq(operators.id, payload.sub), eq(operators.eventId, terminal.eventId)))
      .limit(1);
    if (!operator?.active) throw unauthorized('Operador desactivat');
    c.set('operator', { id: operator.id, name: operator.name, role: operator.role, eventId: operator.eventId });
    await next();
  });

  return { requireAdmin, requireTerminal, requireOperator };
}

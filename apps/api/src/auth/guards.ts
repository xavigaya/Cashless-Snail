import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { OperatorRole } from '@cashless/shared';
import { DomainError, unauthorized } from '../common/errors';
import { sha256 } from '../common/crypto';
import { DB, type Db } from '../db/db';
import { adminUsers, events, operators, pointsOfSale, roleAssignments, terminals } from '../db/schema';

export interface AdminTokenPayload {
  sub: string;
  kind: 'admin';
}

export interface OperatorTokenPayload {
  sub: string;
  kind: 'operator';
  terminalId: string;
  eventId: string;
}

export const TERMINAL_TOKEN_HEADER = 'x-terminal-token';
const LAST_SEEN_THROTTLE_MS = 30_000;

function bearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Usuaris del backoffice (token JWT de tipus admin). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = bearer(request);
    if (!token) throw unauthorized();
    let payload: AdminTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminTokenPayload>(token);
    } catch {
      throw unauthorized('La sessió ha caducat');
    }
    if (payload.kind !== 'admin') throw unauthorized();

    const [user] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, payload.sub)).limit(1);
    if (!user?.active) throw unauthorized();
    const roles = await this.db
      .select({ role: roleAssignments.role, organizationId: roleAssignments.organizationId, eventId: roleAssignments.eventId })
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, user.id));
    request.admin = { id: user.id, email: user.email, name: user.name, roles };
    return true;
  }
}

/** Terminals vinculats (capçalera X-Terminal-Token). */
@Injectable()
export class TerminalGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers[TERMINAL_TOKEN_HEADER];
    if (typeof token !== 'string' || !token) throw unauthorized('Terminal no vinculat');

    const [row] = await this.db
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

    request.terminal = {
      id: row.terminal.id,
      name: row.terminal.name,
      eventId: row.terminal.eventId,
      organizationId: row.organizationId,
      pointOfSaleId: row.pos.id,
      posKind: row.pos.kind,
      vendorId: row.pos.vendorId,
    };

    const lastSeen = row.terminal.lastSeenAt?.getTime() ?? 0;
    if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      await this.db.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, row.terminal.id));
    }
    return true;
  }
}

/**
 * Operador amb sessió oberta en aquest terminal.
 * S'ha de fer servir sempre després de TerminalGuard: @UseGuards(TerminalGuard, OperatorGuard).
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const terminal = request.terminal;
    if (!terminal) throw unauthorized('Terminal no vinculat');
    const token = bearer(request);
    if (!token) throw unauthorized('Cal entrar amb el PIN');
    let payload: OperatorTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<OperatorTokenPayload>(token);
    } catch {
      throw unauthorized('La sessió ha caducat: torna a entrar amb el PIN');
    }
    if (payload.kind !== 'operator' || payload.terminalId !== terminal.id) throw unauthorized('Cal entrar amb el PIN');

    const [operator] = await this.db
      .select()
      .from(operators)
      .where(and(eq(operators.id, payload.sub), eq(operators.eventId, terminal.eventId)))
      .limit(1);
    if (!operator?.active) throw unauthorized('Operador desactivat');
    request.operator = { id: operator.id, name: operator.name, role: operator.role, eventId: operator.eventId };
    return true;
  }
}

export function assertOperatorRole(role: OperatorRole, allowed: readonly OperatorRole[]): void {
  if (!allowed.includes(role)) {
    throw new DomainError('FORBIDDEN_FOR_ROLE', 'El teu rol no permet fer aquesta operació', 403);
  }
}

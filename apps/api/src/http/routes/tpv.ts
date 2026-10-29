/**
 * Endpoints que fan servir els terminals.
 * Tots (excepte /tpv/pair) necessiten la capçalera X-Terminal-Token.
 * Les operacions, a més, necessiten la sessió de l'operador (Authorization: Bearer).
 */
import { Hono } from 'hono';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  activationSchema,
  operatorLoginSchema,
  pairTerminalSchema,
  saleSchema,
  topupSchema,
  voidSchema,
  wristbandRefSchema,
  type OperatorSession,
  type PairResult,
  type TerminalContext,
} from '@cashless/shared';
import { randomToken, sha256, verifySecret } from '../../common/crypto';
import { DomainError, forbidden, notFound, parseInput } from '../../common/errors';
import { signJwt } from '../../common/jwt';
import { events, movements, operators, pointsOfSale, products, terminals } from '../../db/schema';
import {
  assertOperatorRole,
  BOX_OFFICE_ROLES,
  SALE_ROLES,
  VOID_ROLES,
  type OperatorPrincipal,
  type OperatorTokenPayload,
  type TerminalPrincipal,
} from '../../auth/principals';
import type { OperationContext } from '../../ledger/ledger.service';
import { listMovements } from '../../ledger/views';
import { toProduct } from '../../admin/mappers';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppDeps, type AppEnv } from '../context';

const OPERATOR_SESSION_HOURS = 12;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 5;

export function tpvRoutes(deps: AppDeps) {
  const { db, config, ledger } = deps;
  const { requireTerminal, requireOperator } = authMiddleware(deps);
  const app = new Hono<AppEnv>({ strict: false });

  async function terminalContext(terminalId: string): Promise<TerminalContext> {
    const [row] = await db
      .select({ terminal: terminals, pos: pointsOfSale, event: events })
      .from(terminals)
      .innerJoin(pointsOfSale, eq(pointsOfSale.id, terminals.pointOfSaleId))
      .innerJoin(events, eq(events.id, terminals.eventId))
      .where(eq(terminals.id, terminalId))
      .limit(1);
    if (!row) throw notFound('Terminal');

    // Les taquilles només mostren taquillers; les barres, la resta de rols.
    const allowedRoles = row.pos.kind === 'box_office' ? BOX_OFFICE_ROLES : SALE_ROLES;
    const ops = await db
      .select({ id: operators.id, name: operators.name, role: operators.role })
      .from(operators)
      .where(and(eq(operators.eventId, row.event.id), eq(operators.active, true)))
      .orderBy(asc(operators.name));

    return {
      terminal: { id: row.terminal.id, name: row.terminal.name },
      event: {
        id: row.event.id,
        name: row.event.name,
        status: row.event.status,
        wristbandPriceCents: row.event.wristbandPriceCents,
        wristbandDepositCents: row.event.wristbandDepositCents,
      },
      pointOfSale: { id: row.pos.id, name: row.pos.name, kind: row.pos.kind },
      operators: ops.filter((o) => allowedRoles.includes(o.role)),
    };
  }

  async function operationContext(terminal: TerminalPrincipal, operator: OperatorPrincipal): Promise<OperationContext> {
    const [event] = await db.select().from(events).where(eq(events.id, terminal.eventId)).limit(1);
    if (!event) throw notFound('Esdeveniment');
    return {
      event,
      pointOfSaleId: terminal.pointOfSaleId,
      vendorId: terminal.vendorId,
      terminalId: terminal.id,
      operatorId: operator.id,
      adminUserId: null,
    };
  }

  app.post('/tpv/pair', async (c) => {
    const input = parseInput(pairTerminalSchema, await readJson(c));
    const token = randomToken();
    // Una sola actualització condicional: si dos dispositius fan servir el mateix codi alhora,
    // només un el consumeix i l'altre rep un error (no queda cap dispositiu amb un token invàlid).
    const [terminal] = await db
      .update(terminals)
      .set({
        tokenHash: sha256(token),
        pairingCode: null,
        pairingExpiresAt: null,
        pairedAt: new Date(),
        lastSeenAt: new Date(),
        deviceName: input.deviceName,
      })
      .where(and(eq(terminals.pairingCode, input.pairingCode), gt(terminals.pairingExpiresAt, new Date()), eq(terminals.active, true)))
      .returning({ id: terminals.id });
    if (!terminal) {
      throw new DomainError('INVALID_PAIRING_CODE', 'Codi de vinculació incorrecte o caducat', 401);
    }
    const result: PairResult = { terminalToken: token, context: await terminalContext(terminal.id) };
    return c.json(result, 200);
  });

  app.get('/tpv/context', requireTerminal, async (c) => c.json(await terminalContext(c.get('terminal').id)));

  app.post('/tpv/login', requireTerminal, async (c) => {
    const terminal = c.get('terminal');
    const input = parseInput(operatorLoginSchema, await readJson(c));
    const [operator] = await db
      .select()
      .from(operators)
      .where(and(eq(operators.id, input.operatorId), eq(operators.eventId, terminal.eventId), eq(operators.active, true)))
      .limit(1);
    if (!operator) throw new DomainError('INVALID_PIN', 'PIN incorrecte', 401);
    if (operator.lockedUntil && operator.lockedUntil > new Date()) {
      throw new DomainError('OPERATOR_LOCKED', 'Massa intents fallits: espera uns minuts', 429);
    }

    if (!(await verifySecret(input.pin, operator.pinHash))) {
      // Increment atòmic: diverses peticions en paral·lel no poden saltar-se el límit d'intents.
      const [counted] = await db
        .update(operators)
        .set({ failedAttempts: sql`${operators.failedAttempts} + 1` })
        .where(eq(operators.id, operator.id))
        .returning({ failedAttempts: operators.failedAttempts });
      if ((counted?.failedAttempts ?? 0) >= MAX_PIN_ATTEMPTS) {
        await db
          .update(operators)
          .set({ failedAttempts: 0, lockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) })
          .where(eq(operators.id, operator.id));
      }
      throw new DomainError('INVALID_PIN', 'PIN incorrecte', 401);
    }
    if (operator.failedAttempts > 0 || operator.lockedUntil) {
      await db.update(operators).set({ failedAttempts: 0, lockedUntil: null }).where(eq(operators.id, operator.id));
    }

    // El rol es comprova després del PIN, perquè sense PIN no es pugui saber el rol de ningú.
    const allowed = terminal.posKind === 'box_office' ? BOX_OFFICE_ROLES : SALE_ROLES;
    assertOperatorRole(operator.role, allowed);

    const payload: OperatorTokenPayload = { sub: operator.id, kind: 'operator', terminalId: terminal.id, eventId: terminal.eventId };
    const session: OperatorSession = {
      token: signJwt({ ...payload }, config.jwtSecret, OPERATOR_SESSION_HOURS * 3600),
      operator: { id: operator.id, name: operator.name, role: operator.role },
      expiresAt: new Date(Date.now() + OPERATOR_SESSION_HOURS * 3_600_000).toISOString(),
    };
    return c.json(session, 200);
  });

  app.get('/tpv/catalog', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    if (!terminal.vendorId) return c.json([]);
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.eventId, terminal.eventId), eq(products.vendorId, terminal.vendorId), eq(products.active, true)))
      .orderBy(asc(products.sortOrder), asc(products.name));
    return c.json(rows.map(toProduct));
  });

  app.get('/tpv/balance', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    const ref = parseInput(wristbandRefSchema, c.req.query());
    return c.json(await ledger.balance({ id: terminal.eventId, organizationId: terminal.organizationId }, ref));
  });

  app.get('/tpv/recent', requireTerminal, requireOperator, async (c) => {
    const page = await listMovements(db, eq(movements.terminalId, c.get('terminal').id), { limit: 20 });
    return c.json(page.items);
  });

  app.post('/tpv/sales', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    const operator = c.get('operator');
    const body = parseInput(saleSchema, await readJson(c));
    if (terminal.posKind === 'box_office') throw forbidden('Una taquilla no pot vendre productes');
    assertOperatorRole(operator.role, SALE_ROLES);
    return c.json(await ledger.sale(await operationContext(terminal, operator), body), 201);
  });

  app.post('/tpv/topups', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    const operator = c.get('operator');
    const body = parseInput(topupSchema, await readJson(c));
    if (terminal.posKind !== 'box_office') throw forbidden('Les recàrregues es fan a la taquilla');
    assertOperatorRole(operator.role, BOX_OFFICE_ROLES);
    return c.json(await ledger.topup(await operationContext(terminal, operator), body), 201);
  });

  app.post('/tpv/activations', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    const operator = c.get('operator');
    const body = parseInput(activationSchema, await readJson(c));
    if (terminal.posKind !== 'box_office') throw forbidden('Les polseres s’activen a la taquilla');
    assertOperatorRole(operator.role, BOX_OFFICE_ROLES);
    return c.json(await ledger.activate(await operationContext(terminal, operator), body), 201);
  });

  app.post('/tpv/voids', requireTerminal, requireOperator, async (c) => {
    const terminal = c.get('terminal');
    const operator = c.get('operator');
    const body = parseInput(voidSchema, await readJson(c));
    assertOperatorRole(operator.role, VOID_ROLES);
    const result = await ledger.void(await operationContext(terminal, operator), body, {
      allowedTypes: ['sale'],
      pointOfSaleId: terminal.pointOfSaleId,
    });
    return c.json(result, 201);
  });

  return app;
}

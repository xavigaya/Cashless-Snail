/** Operadors (voluntaris amb PIN) i terminals d'un esdeveniment. */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { createOperatorSchema, createTerminalSchema, updateOperatorSchema, updateTerminalSchema } from '@cashless/shared';
import { generatePairingCode, hashSecret } from '../../common/crypto';
import { deleteOrConflict, notFound, parseInput, parseUuid, unprocessable } from '../../common/errors';
import { operators, pointsOfSale, terminals } from '../../db/schema';
import { toOperator, toTerminal } from '../../admin/mappers';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppDeps, type AppEnv } from '../context';

const PAIRING_MINUTES = 30;

export function newPairing(): { pairingCode: string; pairingExpiresAt: Date } {
  return { pairingCode: generatePairingCode(), pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60_000) };
}

export function staffRoutes(deps: AppDeps) {
  const { db, access } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>({ strict: false });


  async function assertPointOfSaleInEvent(eventId: string, posId: string): Promise<void> {
    const [pos] = await db
      .select({ id: pointsOfSale.id })
      .from(pointsOfSale)
      .where(and(eq(pointsOfSale.id, posId), eq(pointsOfSale.eventId, eventId)))
      .limit(1);
    if (!pos) throw unprocessable('VALIDATION_ERROR', 'El punt de venda no pertany a aquest esdeveniment');
  }

  // ---------- Operadors ----------

  app.get('/events/:eventId/operators', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    await access.event(c.get('admin'), eventId);
    return c.json((await db.select().from(operators).where(eq(operators.eventId, eventId)).orderBy(asc(operators.name))).map(toOperator));
  });

  app.post('/events/:eventId/operators', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const body = parseInput(createOperatorSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const [row] = await db
      .insert(operators)
      .values({ eventId, name: body.name, role: body.role, pinHash: await hashSecret(body.pin) })
      .returning();
    return c.json(toOperator(row!), 201);
  });

  app.patch('/events/:eventId/operators/:operatorId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const operatorId = parseUuid(c.req.param('operatorId'), 'operatorId');
    const { pin, ...rest } = parseInput(updateOperatorSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    const changes = pin ? { ...rest, pinHash: await hashSecret(pin), failedAttempts: 0, lockedUntil: null } : rest;
    const [row] = await db
      .update(operators)
      .set(changes)
      .where(and(eq(operators.id, operatorId), eq(operators.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Operador');
    return c.json(toOperator(row));
  });

  app.delete('/events/:eventId/operators/:operatorId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const operatorId = parseUuid(c.req.param('operatorId'), 'operatorId');
    await access.event(c.get('admin'), eventId);
    await deleteOrConflict('l’operador', async () => {
      const rows = await db.delete(operators).where(and(eq(operators.id, operatorId), eq(operators.eventId, eventId))).returning({ id: operators.id });
      return rows.length;
    });
    await access.audit(db, c.get('admin'), { eventId, action: 'operator.delete', targetType: 'operator', targetId: operatorId });
    return c.body(null, 204);
  });

  // ---------- Terminals ----------

  app.get('/events/:eventId/terminals', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    await access.event(c.get('admin'), eventId);
    return c.json((await db.select().from(terminals).where(eq(terminals.eventId, eventId)).orderBy(asc(terminals.name))).map(toTerminal));
  });

  /** Crea un terminal amb un codi de vinculació vàlid durant 30 minuts. */
  app.post('/events/:eventId/terminals', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const body = parseInput(createTerminalSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    await assertPointOfSaleInEvent(eventId, body.pointOfSaleId);
    const [row] = await db
      .insert(terminals)
      .values({ eventId, name: body.name, pointOfSaleId: body.pointOfSaleId, ...newPairing() })
      .returning();
    await access.audit(db, c.get('admin'), { eventId, action: 'terminal.create', targetType: 'terminal', targetId: row!.id });
    return c.json(toTerminal(row!), 201);
  });

  app.patch('/events/:eventId/terminals/:terminalId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const terminalId = parseUuid(c.req.param('terminalId'), 'terminalId');
    const body = parseInput(updateTerminalSchema, await readJson(c));
    await access.event(c.get('admin'), eventId);
    if (body.pointOfSaleId) await assertPointOfSaleInEvent(eventId, body.pointOfSaleId);
    const [row] = await db
      .update(terminals)
      .set(body)
      .where(and(eq(terminals.id, terminalId), eq(terminals.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Terminal');
    if (body.active === false) {
      await access.audit(db, c.get('admin'), { eventId, action: 'terminal.disable', targetType: 'terminal', targetId: terminalId });
    }
    return c.json(toTerminal(row));
  });

  app.delete('/events/:eventId/terminals/:terminalId', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const terminalId = parseUuid(c.req.param('terminalId'), 'terminalId');
    await access.event(c.get('admin'), eventId);
    await deleteOrConflict('el terminal', async () => {
      const rows = await db.delete(terminals).where(and(eq(terminals.id, terminalId), eq(terminals.eventId, eventId))).returning({ id: terminals.id });
      return rows.length;
    });
    await access.audit(db, c.get('admin'), { eventId, action: 'terminal.delete', targetType: 'terminal', targetId: terminalId });
    return c.body(null, 204);
  });

  /**
   * Genera un codi nou per vincular el terminal a un dispositiu.
   * El dispositiu anterior continua funcionant fins que se'n vinculi un de nou.
   */
  app.post('/events/:eventId/terminals/:terminalId/pairing-code', requireAdmin, async (c) => {
    const eventId = parseUuid(c.req.param('eventId'), 'eventId');
    const terminalId = parseUuid(c.req.param('terminalId'), 'terminalId');
    await access.event(c.get('admin'), eventId);
    const [row] = await db
      .update(terminals)
      .set(newPairing())
      .where(and(eq(terminals.id, terminalId), eq(terminals.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Terminal');
    await access.audit(db, c.get('admin'), { eventId, action: 'terminal.pairing_code', targetType: 'terminal', targetId: terminalId });
    return c.json(toTerminal(row), 201);
  });

  return app;
}

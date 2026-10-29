import { Hono } from 'hono';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  createAdminUserSchema,
  MOVEMENT_TYPES,
  updateEventSchema,
  voidSchema,
  wristbandRefSchema,
  wristbandStatusSchema,
  type EventTotals,
  type MovementType,
} from '@cashless/shared';
import { badRequest, notFound, parseInput, parseUuid } from '../../common/errors';
import { events, movements, wallets, wristbands } from '../../db/schema';
import { assertCanManageOrganization } from '../../auth/principals';
import { grantAdminRole } from '../../admin/admin-access';
import { toEvent } from '../../admin/mappers';
import { isActivatedInEvent, listMovements, toBalance } from '../../ledger/views';
import { authMiddleware } from '../auth-middleware';
import { readJson, type AppContext, type AppDeps, type AppEnv } from '../context';

const movementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
});

interface AggregateRow extends Record<string, unknown> {
  type: MovementType;
  orig_type: string | null;
  payment_method: string;
  n: number;
  amount: number;
  paid: number;
  promo: number;
  deposit: number;
}

export function eventRoutes(deps: AppDeps) {
  const { db, access, ledger } = deps;
  const { requireAdmin } = authMiddleware(deps);
  const app = new Hono<AppEnv>();

  const eventId = (c: AppContext) => parseUuid(c.req.param('eventId'), 'eventId');

  app.get('/events/:eventId', requireAdmin, async (c) => c.json(toEvent(await access.event(c.get('admin'), eventId(c)))));

  app.patch('/events/:eventId', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const id = eventId(c);
    const event = await access.event(admin, id);
    const body = parseInput(updateEventSchema, await readJson(c));
    const startsAt = body.startsAt ?? event.startsAt;
    const endsAt = body.endsAt ?? event.endsAt;
    if (endsAt <= startsAt) throw badRequest('La data de final ha de ser posterior a la d’inici');
    const [row] = await db
      .update(events)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(events.id, event.id))
      .returning();
    await access.audit(db, admin, { eventId: id, action: 'event.update', targetType: 'event', targetId: id, data: body });
    return c.json(toEvent(row!));
  });

  /** Dona el rol de responsable d'esdeveniment a un usuari. Només l'admin de l'entitat. */
  app.post('/events/:eventId/managers', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const id = eventId(c);
    const event = await access.event(admin, id);
    assertCanManageOrganization(admin, event.organizationId);
    const body = parseInput(createAdminUserSchema, await readJson(c));
    const user = await grantAdminRole(db, admin, body, 'event_manager', { eventId: id });
    await access.audit(db, admin, { eventId: id, action: 'event.add_manager', targetType: 'admin_user', targetId: user.id });
    return c.json(user, 201);
  });

  app.get('/events/:eventId/movements', requireAdmin, async (c) => {
    const id = eventId(c);
    await access.event(c.get('admin'), id);
    const query = parseInput(movementQuerySchema, c.req.query());
    const filters: SQL[] = [eq(movements.eventId, id)];
    if (query.type) filters.push(eq(movements.type, query.type));
    return c.json(await listMovements(db, and(...filters)!, { limit: query.limit, cursor: query.cursor }));
  });

  /** Anul·lació des del backoffice: vendes i recàrregues. */
  app.post('/events/:eventId/voids', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const id = eventId(c);
    const event = await access.event(admin, id);
    const body = parseInput(voidSchema, await readJson(c));
    const result = await ledger.void(
      { event, pointOfSaleId: null, vendorId: null, terminalId: null, operatorId: null, adminUserId: admin.id },
      body,
      { allowedTypes: ['sale', 'topup'] },
    );
    if (!result.replayed) {
      await access.audit(db, admin, { eventId: id, action: 'movement.void', targetType: 'movement', targetId: body.movementId, data: { reason: body.reason } });
    }
    return c.json(result, 201);
  });

  app.get('/events/:eventId/wristbands/lookup', requireAdmin, async (c) => {
    const id = eventId(c);
    const event = await access.event(c.get('admin'), id);
    const ref = parseInput(wristbandRefSchema, c.req.query());
    const balance = await ledger.balance(event, ref);
    const page = await listMovements(db, and(eq(movements.eventId, id), eq(movements.wristbandId, balance.wristbandId))!, { limit: 100 });
    return c.json({ balance, movements: page.items });
  });

  /**
   * Bloqueja o desbloqueja la polsera per a l'entitat de l'esdeveniment.
   * No afecta el saldo que la polsera pugui tenir en altres entitats.
   */
  app.patch('/events/:eventId/wristbands/:wristbandId/status', requireAdmin, async (c) => {
    const admin = c.get('admin');
    const id = eventId(c);
    const wristbandId = parseUuid(c.req.param('wristbandId'), 'wristbandId');
    const event = await access.event(admin, id);
    const body = parseInput(wristbandStatusSchema, await readJson(c));
    const [wallet] = await db
      .update(wallets)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(wallets.wristbandId, wristbandId), eq(wallets.organizationId, event.organizationId)))
      .returning();
    if (!wallet) throw notFound('Polsera');
    const [wristband] = await db.select().from(wristbands).where(eq(wristbands.id, wristbandId)).limit(1);
    await access.audit(db, admin, { eventId: id, action: 'wristband.status', targetType: 'wristband', targetId: wristbandId, data: body });
    return c.json(toBalance(wristband!, wallet, await isActivatedInEvent(db, wallet.id, id)));
  });

  /** Xifres principals de l'esdeveniment, netes d'anul·lacions. */
  app.get('/events/:eventId/summary', requireAdmin, async (c) => {
    const id = eventId(c);
    await access.event(c.get('admin'), id);

    const aggregates = await db.execute<AggregateRow>(sql`
      SELECT m.type, o.type AS orig_type, m.payment_method,
             count(*)::int AS n,
             coalesce(sum(m.amount_cents), 0)::int AS amount,
             coalesce(sum(m.paid_delta_cents), 0)::int AS paid,
             coalesce(sum(m.promo_delta_cents), 0)::int AS promo,
             coalesce(sum(m.deposit_delta_cents), 0)::int AS deposit
      FROM movements m
      LEFT JOIN movements o ON o.id = m.reverses_movement_id
      WHERE m.event_id = ${id}
      GROUP BY 1, 2, 3`);

    const totals: EventTotals = {
      topupsCents: 0,
      topupsByMethod: { cash: 0, card: 0, online: 0 },
      salesCents: 0,
      salesCount: 0,
      voidsCents: 0,
      refundsCents: 0,
      wristbandFeesCents: 0,
      depositsHeldCents: 0,
      paidBalanceOutstandingCents: 0,
      promoBalanceOutstandingCents: 0,
      activeWristbands: 0,
      averageTicketCents: 0,
      salesByVendor: [],
      topProducts: [],
    };

    for (const row of aggregates) {
      totals.paidBalanceOutstandingCents += row.paid;
      totals.promoBalanceOutstandingCents += row.promo;
      totals.depositsHeldCents += row.deposit;
      const method = row.payment_method as 'cash' | 'card' | 'online';
      switch (row.type) {
        case 'topup':
          totals.topupsCents += row.amount;
          if (method in totals.topupsByMethod) totals.topupsByMethod[method] += row.amount;
          break;
        case 'sale':
          totals.salesCents += row.amount;
          totals.salesCount += row.n;
          break;
        case 'void':
          totals.voidsCents += row.amount;
          if (row.orig_type === 'sale') {
            totals.salesCents -= row.amount;
            totals.salesCount -= row.n;
          } else if (row.orig_type === 'topup') {
            totals.topupsCents -= row.amount;
            if (method in totals.topupsByMethod) totals.topupsByMethod[method] -= row.amount;
          }
          break;
        case 'refund':
          totals.refundsCents += row.amount;
          break;
        case 'wristband_fee':
          totals.wristbandFeesCents += row.amount;
          break;
        default:
          break;
      }
    }
    totals.averageTicketCents = totals.salesCount > 0 ? Math.round(totals.salesCents / totals.salesCount) : 0;

    const active = await db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT wallet_id)::int AS n FROM movements WHERE event_id = ${id} AND wallet_id IS NOT NULL`);
    totals.activeWristbands = active[0]?.n ?? 0;

    const byVendor = await db.execute<{ vendor_id: string; vendor_name: string; sales: number; n: number }>(sql`
      SELECT v.id AS vendor_id, v.name AS vendor_name,
             sum(CASE WHEN m.type = 'sale' THEN m.amount_cents ELSE -m.amount_cents END)::int AS sales,
             sum(CASE WHEN m.type = 'sale' THEN 1 ELSE -1 END)::int AS n
      FROM movements m
      JOIN vendors v ON v.id = m.vendor_id
      LEFT JOIN movements o ON o.id = m.reverses_movement_id
      WHERE m.event_id = ${id} AND (m.type = 'sale' OR (m.type = 'void' AND o.type = 'sale'))
      GROUP BY v.id, v.name
      ORDER BY sales DESC`);
    totals.salesByVendor = byVendor.map((r) => ({ vendorId: r.vendor_id, vendorName: r.vendor_name, salesCents: r.sales, count: r.n }));

    const top = await db.execute<{ product_id: string; name: string; quantity: number; total: number }>(sql`
      SELECT l.product_id, l.name, sum(l.quantity)::int AS quantity, sum(l.total_cents)::int AS total
      FROM movement_lines l
      JOIN movements m ON m.id = l.movement_id
      WHERE m.event_id = ${id} AND m.type = 'sale'
        AND NOT EXISTS (SELECT 1 FROM movements v WHERE v.reverses_movement_id = m.id)
      GROUP BY l.product_id, l.name
      ORDER BY total DESC
      LIMIT 10`);
    totals.topProducts = top.map((r) => ({ productId: r.product_id, name: r.name, quantity: r.quantity, totalCents: r.total }));

    return c.json(totals);
  });

  return app;
}

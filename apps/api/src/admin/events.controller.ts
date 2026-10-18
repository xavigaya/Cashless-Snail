import { Body, Controller, Get, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  createAdminUserSchema,
  MOVEMENT_TYPES,
  updateEventSchema,
  voidSchema,
  wristbandRefSchema,
  wristbandStatusSchema,
  type Balance,
  type CreateAdminUserInput,
  type EventSummary,
  type EventTotals,
  type Movement,
  type MovementType,
  type OperationResult,
  type Page,
  type UpdateEventInput,
  type VoidInput,
  type WristbandRef,
  type WristbandStatusInput,
} from '@cashless/shared';
import { DomainError, notFound, ZodPipe } from '../common/errors';
import { DB, type Db } from '../db/db';
import { events, movements, wallets, wristbands } from '../db/schema';
import { AdminGuard } from '../auth/guards';
import { assertCanManageOrganization, CurrentAdmin, type AdminPrincipal } from '../auth/principals';
import { LedgerService } from '../ledger/ledger.service';
import { listMovements, toBalance } from '../ledger/views';
import { AdminAccessService } from './admin-access.service';
import { toEvent } from './mappers';
import { grantAdminRole } from './organizations.controller';

const movementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
});
type MovementQuery = z.infer<typeof movementQuerySchema>;

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

@Controller('events/:eventId')
@UseGuards(AdminGuard)
export class EventsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AdminAccessService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  async get(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<EventSummary> {
    return toEvent(await this.access.event(admin, eventId));
  }

  @Patch()
  async update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(updateEventSchema)) body: UpdateEventInput,
  ): Promise<EventSummary> {
    const event = await this.access.event(admin, eventId);
    const startsAt = body.startsAt ?? event.startsAt;
    const endsAt = body.endsAt ?? event.endsAt;
    if (endsAt <= startsAt) {
      throw new DomainError('VALIDATION_ERROR', 'La data de final ha de ser posterior a la d’inici', HttpStatus.BAD_REQUEST);
    }
    const [row] = await this.db
      .update(events)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(events.id, event.id))
      .returning();
    await this.access.audit(this.db, admin, { eventId, action: 'event.update', targetType: 'event', targetId: eventId, data: body });
    return toEvent(row!);
  }

  /** Dona el rol de responsable d'esdeveniment a un usuari. Només l'admin de l'entitat. */
  @Post('managers')
  async addManager(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createAdminUserSchema)) body: CreateAdminUserInput,
  ): Promise<{ id: string; email: string; name: string }> {
    const event = await this.access.event(admin, eventId);
    assertCanManageOrganization(admin, event.organizationId);
    const user = await grantAdminRole(this.db, admin, body, 'event_manager', { eventId });
    await this.access.audit(this.db, admin, { eventId, action: 'event.add_manager', targetType: 'admin_user', targetId: user.id });
    return user;
  }

  @Get('movements')
  async movements(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query(new ZodPipe(movementQuerySchema)) query: MovementQuery,
  ): Promise<Page<Movement>> {
    await this.access.event(admin, eventId);
    const filters: SQL[] = [eq(movements.eventId, eventId)];
    if (query.type) filters.push(eq(movements.type, query.type));
    return listMovements(this.db, and(...filters)!, { limit: query.limit, cursor: query.cursor });
  }

  /** Anul·lació des del backoffice: vendes i recàrregues. */
  @Post('voids')
  async void(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(voidSchema)) body: VoidInput,
  ): Promise<OperationResult> {
    const event = await this.access.event(admin, eventId);
    const result = await this.ledger.void(
      { event, pointOfSaleId: null, vendorId: null, terminalId: null, operatorId: null, adminUserId: admin.id },
      body,
      { allowedTypes: ['sale', 'topup'] },
    );
    if (!result.replayed) {
      await this.access.audit(this.db, admin, { eventId, action: 'movement.void', targetType: 'movement', targetId: body.movementId, data: { reason: body.reason } });
    }
    return result;
  }

  @Get('wristbands/lookup')
  async lookupWristband(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query(new ZodPipe(wristbandRefSchema)) ref: WristbandRef,
  ): Promise<{ balance: Balance; movements: Movement[] }> {
    const event = await this.access.event(admin, eventId);
    const balance = await this.ledger.balance(event.organizationId, ref);
    const page = await listMovements(this.db, and(eq(movements.eventId, eventId), eq(movements.wristbandId, balance.wristbandId))!, {
      limit: 100,
    });
    return { balance, movements: page.items };
  }

  /**
   * Bloqueja o desbloqueja la polsera per a l'entitat de l'esdeveniment.
   * No afecta el saldo que la polsera pugui tenir en altres entitats.
   */
  @Patch('wristbands/:wristbandId/status')
  async setWristbandStatus(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('wristbandId', ParseUUIDPipe) wristbandId: string,
    @Body(new ZodPipe(wristbandStatusSchema)) body: WristbandStatusInput,
  ): Promise<Balance> {
    const event = await this.access.event(admin, eventId);
    const [wallet] = await this.db
      .update(wallets)
      .set({ status: body.status, updatedAt: new Date() })
      .where(and(eq(wallets.wristbandId, wristbandId), eq(wallets.organizationId, event.organizationId)))
      .returning();
    if (!wallet) throw notFound('Polsera');
    const [wristband] = await this.db.select().from(wristbands).where(eq(wristbands.id, wristbandId)).limit(1);
    await this.access.audit(this.db, admin, { eventId, action: 'wristband.status', targetType: 'wristband', targetId: wristbandId, data: body });
    return toBalance(wristband!, wallet);
  }

  /** Xifres principals de l'esdeveniment, netes d'anul·lacions. */
  @Get('summary')
  async summary(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<EventTotals> {
    await this.access.event(admin, eventId);

    const aggregates = await this.db.execute<AggregateRow>(sql`
      SELECT m.type, o.type AS orig_type, m.payment_method,
             count(*)::int AS n,
             coalesce(sum(m.amount_cents), 0)::int AS amount,
             coalesce(sum(m.paid_delta_cents), 0)::int AS paid,
             coalesce(sum(m.promo_delta_cents), 0)::int AS promo,
             coalesce(sum(m.deposit_delta_cents), 0)::int AS deposit
      FROM movements m
      LEFT JOIN movements o ON o.id = m.reverses_movement_id
      WHERE m.event_id = ${eventId}
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

    for (const row of aggregates.rows) {
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

    const active = await this.db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT wallet_id)::int AS n FROM movements WHERE event_id = ${eventId} AND wallet_id IS NOT NULL`);
    totals.activeWristbands = active.rows[0]?.n ?? 0;

    const byVendor = await this.db.execute<{ vendor_id: string; vendor_name: string; sales: number; n: number }>(sql`
      SELECT v.id AS vendor_id, v.name AS vendor_name,
             sum(CASE WHEN m.type = 'sale' THEN m.amount_cents ELSE -m.amount_cents END)::int AS sales,
             sum(CASE WHEN m.type = 'sale' THEN 1 ELSE -1 END)::int AS n
      FROM movements m
      JOIN vendors v ON v.id = m.vendor_id
      LEFT JOIN movements o ON o.id = m.reverses_movement_id
      WHERE m.event_id = ${eventId} AND (m.type = 'sale' OR (m.type = 'void' AND o.type = 'sale'))
      GROUP BY v.id, v.name
      ORDER BY sales DESC`);
    totals.salesByVendor = byVendor.rows.map((r) => ({ vendorId: r.vendor_id, vendorName: r.vendor_name, salesCents: r.sales, count: r.n }));

    const top = await this.db.execute<{ product_id: string; name: string; quantity: number; total: number }>(sql`
      SELECT l.product_id, l.name, sum(l.quantity)::int AS quantity, sum(l.total_cents)::int AS total
      FROM movement_lines l
      JOIN movements m ON m.id = l.movement_id
      WHERE m.event_id = ${eventId} AND m.type = 'sale'
        AND NOT EXISTS (SELECT 1 FROM movements v WHERE v.reverses_movement_id = m.id)
      GROUP BY l.product_id, l.name
      ORDER BY total DESC
      LIMIT 10`);
    totals.topProducts = top.rows.map((r) => ({ productId: r.product_id, name: r.name, quantity: r.quantity, totalCents: r.total }));

    return totals;
  }
}

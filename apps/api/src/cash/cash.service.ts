/**
 * Caixa de les taquilles: torns (obrir amb fons de canvi, tancar declarant l'efectiu)
 * i resum per terminal i jornada.
 *
 * No modifica saldos: només llegeix els moviments que el llibre (LedgerService) ha marcat amb el torn.
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { CashDailyRow, CashReport, CashShift, CloseShiftInput, OpenShiftInput } from '@cashless/shared';
import { conflict, notFound } from '../common/errors';
import { isUniqueViolation, type Db, type Queryable } from '../db/db';
import { adminUsers, cashShifts, movements, operators, terminals, type CashShiftRow } from '../db/schema';

/** Zona i hora de canvi de jornada: una nit de festa compta com un sol dia. */
const TIME_ZONE = 'Europe/Madrid';
const DAY_STARTS_AT_HOUR = 6;

/** Import amb signe per a un mètode de pagament: entrades positives, devolucions i anul·lacions negatives. */
function signedSum(method: 'cash' | 'card'): SQL<number> {
  return sql<number>`coalesce(sum(CASE
    WHEN ${movements.paymentMethod} <> ${method} THEN 0
    WHEN ${movements.type} IN ('topup', 'wristband_fee', 'deposit') THEN ${movements.amountCents}
    WHEN ${movements.type} IN ('refund', 'deposit_return', 'void') THEN -${movements.amountCents}
    ELSE 0 END), 0)::int`;
}

export interface ShiftCloser {
  operatorId?: string;
  adminUserId?: string;
}

export class CashService {
  constructor(private readonly db: Db) {}

  /** Torn obert d'un terminal (de qualsevol operador), o null. */
  async openShiftOf(db: Queryable, terminalId: string): Promise<CashShiftRow | null> {
    const [row] = await db
      .select()
      .from(cashShifts)
      .where(and(eq(cashShifts.terminalId, terminalId), isNull(cashShifts.closedAt)))
      .limit(1);
    return row ?? null;
  }

  async open(where: { eventId: string; terminalId: string; operatorId: string }, input: OpenShiftInput): Promise<CashShift> {
    // Reintent de la mateixa petició: es retorna el torn ja creat.
    const [existing] = await this.db.select().from(cashShifts).where(eq(cashShifts.id, input.id)).limit(1);
    if (existing) {
      if (existing.terminalId !== where.terminalId) throw conflict('CONFLICT', 'Aquest identificador ja s’ha fet servir');
      return this.get(existing.id);
    }
    if (await this.openShiftOf(this.db, where.terminalId)) {
      throw conflict('SHIFT_ALREADY_OPEN', 'Aquesta taquilla ja té un torn obert: cal tancar-lo primer');
    }
    try {
      await this.db.insert(cashShifts).values({ id: input.id, ...where, openingFloatCents: input.openingFloatCents });
    } catch (error) {
      if (isUniqueViolation(error, 'cash_shifts_one_open_per_terminal')) {
        throw conflict('SHIFT_ALREADY_OPEN', 'Aquesta taquilla ja té un torn obert: cal tancar-lo primer');
      }
      if (isUniqueViolation(error, 'cash_shifts_pkey')) return this.get(input.id);
      throw error;
    }
    return this.get(input.id);
  }

  /**
   * Tanca el torn. Bloqueja la fila: les operacions de caixa en curs (que la bloquegen en mode compartit)
   * acaben abans, i les noves ja veuen el torn tancat. Així l'efectiu esperat és exacte.
   */
  async close(shiftId: string, closer: ShiftCloser, input: CloseShiftInput): Promise<CashShift> {
    await this.db.transaction(async (tx) => {
      const [shift] = await tx.select().from(cashShifts).where(eq(cashShifts.id, shiftId)).for('update');
      if (!shift) throw notFound('Torn');
      if (shift.closedAt) {
        // Reintent del mateix tancament (p. ex. es va perdre la resposta): es retorna el resultat.
        if (shift.declaredCashCents === input.declaredCashCents) return;
        throw conflict('SHIFT_CLOSED', 'Aquest torn ja està tancat');
      }
      const totals = (await this.totals(tx, [shiftId])).get(shiftId);
      await tx
        .update(cashShifts)
        .set({
          closedAt: new Date(),
          closedByOperatorId: closer.operatorId ?? null,
          closedByAdminId: closer.adminUserId ?? null,
          declaredCashCents: input.declaredCashCents,
          expectedCashCents: shift.openingFloatCents + (totals?.cash ?? 0),
          note: input.note ?? null,
        })
        .where(eq(cashShifts.id, shiftId));
    });
    return this.get(shiftId);
  }

  async get(shiftId: string): Promise<CashShift> {
    const [shift] = await this.list(eq(cashShifts.id, shiftId));
    if (!shift) throw notFound('Torn');
    return shift;
  }

  async report(eventId: string): Promise<CashReport> {
    return { shifts: await this.list(eq(cashShifts.eventId, eventId)), daily: await this.daily(eventId) };
  }

  /** Comprova que el torn és d'aquest esdeveniment (per a les rutes del backoffice). */
  async assertInEvent(shiftId: string, eventId: string): Promise<void> {
    const [row] = await this.db.select({ eventId: cashShifts.eventId }).from(cashShifts).where(eq(cashShifts.id, shiftId)).limit(1);
    if (!row || row.eventId !== eventId) throw notFound('Torn');
  }

  // ---------------------------------------------------------------

  private async totals(db: Queryable, ids: string[]): Promise<Map<string, { cash: number; card: number; n: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ shiftId: movements.shiftId, cash: signedSum('cash'), card: signedSum('card'), n: sql<number>`count(*)::int` })
      .from(movements)
      .where(inArray(movements.shiftId, ids))
      .groupBy(movements.shiftId);
    return new Map(rows.map((r) => [r.shiftId!, { cash: r.cash, card: r.card, n: r.n }]));
  }

  private async list(filter: SQL): Promise<CashShift[]> {
    const opener = alias(operators, 'opener');
    const closerOp = alias(operators, 'closer_op');
    const rows = await this.db
      .select({
        s: cashShifts,
        terminalName: terminals.name,
        operatorName: opener.name,
        closerOperator: closerOp.name,
        closerAdmin: adminUsers.name,
      })
      .from(cashShifts)
      .innerJoin(terminals, eq(terminals.id, cashShifts.terminalId))
      .innerJoin(opener, eq(opener.id, cashShifts.operatorId))
      .leftJoin(closerOp, eq(closerOp.id, cashShifts.closedByOperatorId))
      .leftJoin(adminUsers, eq(adminUsers.id, cashShifts.closedByAdminId))
      .where(filter)
      .orderBy(desc(cashShifts.openedAt));
    const totals = await this.totals(
      this.db,
      rows.map((r) => r.s.id),
    );

    return rows.map(({ s, terminalName, operatorName, closerOperator, closerAdmin }) => {
      const t = totals.get(s.id) ?? { cash: 0, card: 0, n: 0 };
      const expected = s.expectedCashCents ?? s.openingFloatCents + t.cash;
      return {
        id: s.id,
        eventId: s.eventId,
        terminalId: s.terminalId,
        terminalName,
        operatorId: s.operatorId,
        operatorName,
        openingFloatCents: s.openingFloatCents,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        closedByName: closerOperator ?? (closerAdmin ? `${closerAdmin} (backoffice)` : null),
        cashCents: t.cash,
        cardCents: t.card,
        operations: t.n,
        expectedCashCents: expected,
        declaredCashCents: s.declaredCashCents,
        differenceCents: s.declaredCashCents === null ? null : s.declaredCashCents - expected,
        note: s.note,
      };
    });
  }

  private async daily(eventId: string): Promise<CashDailyRow[]> {
    // Les vendes sense connexió compten a l'hora en què es van fer, no a la de sincronització.
    const rows = await this.db.execute<{
      day: string;
      terminal_id: string | null;
      terminal_name: string | null;
      pos_name: string | null;
      cash: number;
      card: number;
      sales: number;
      n: number;
    }>(sql`
      SELECT to_char(
               -- L'hora del terminal només es fa servir si és plausible (com a molt 2 dies abans de la sincronització).
               (CASE WHEN movements.offline AND movements.client_created_at BETWEEN movements.created_at - interval '2 days' AND movements.created_at
                     THEN movements.client_created_at ELSE movements.created_at END
                 AT TIME ZONE ${TIME_ZONE}) - make_interval(hours => ${DAY_STARTS_AT_HOUR}),
               'YYYY-MM-DD') AS day,
             t.id AS terminal_id, t.name AS terminal_name, p.name AS pos_name,
             ${signedSum('cash')} AS cash,
             ${signedSum('card')} AS card,
             coalesce(sum(CASE WHEN movements.type = 'sale' THEN movements.amount_cents
                               WHEN movements.type = 'void' AND movements.payment_method = 'wallet' THEN -movements.amount_cents
                               ELSE 0 END), 0)::int AS sales,
             count(*)::int AS n
      FROM movements
      -- Una anul·lació del backoffice que compta en un torn de caixa s'atribueix al terminal d'aquell torn.
      LEFT JOIN cash_shifts s ON s.id = movements.shift_id
      LEFT JOIN terminals t ON t.id = coalesce(movements.terminal_id, s.terminal_id)
      LEFT JOIN points_of_sale p ON p.id = t.point_of_sale_id
      WHERE movements.event_id = ${eventId}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 4 NULLS LAST, 3`);
    return rows.map((r) => ({
      day: r.day,
      terminalId: r.terminal_id,
      terminalName: r.terminal_name ?? 'Backoffice',
      pointOfSaleName: r.pos_name,
      cashCents: r.cash,
      cardCents: r.card,
      salesCents: r.sales,
      operations: r.n,
    }));
  }
}


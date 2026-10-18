/** Lectura de moviments i saldos en el format de l'API. */
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { Balance, Movement, Page } from '@cashless/shared';
import type { Queryable } from '../db/db';
import { movementLines, movements, operators, wallets, wristbands, type WalletRow, type WristbandRow } from '../db/schema';

export function toBalance(wristband: WristbandRow, wallet: Pick<WalletRow, 'paidCents' | 'promoCents' | 'depositCents'> | null): Balance {
  const paidCents = wallet?.paidCents ?? 0;
  const promoCents = wallet?.promoCents ?? 0;
  return {
    wristbandId: wristband.id,
    code: wristband.code,
    status: wristband.status,
    paidCents,
    promoCents,
    depositCents: wallet?.depositCents ?? 0,
    availableCents: wristband.status === 'active' ? paidCents + promoCents : 0,
  };
}

export async function loadBalance(db: Queryable, wristband: WristbandRow, organizationId: string): Promise<Balance> {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.wristbandId, wristband.id), eq(wallets.organizationId, organizationId)))
    .limit(1);
  return toBalance(wristband, wallet ?? null);
}

/** Carrega moviments complets (amb línies, codi de polsera i nom d'operador), en l'ordre dels ids. */
export async function loadMovements(db: Queryable, ids: string[]): Promise<Movement[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ m: movements, code: wristbands.code, operatorName: operators.name })
    .from(movements)
    .leftJoin(wristbands, eq(wristbands.id, movements.wristbandId))
    .leftJoin(operators, eq(operators.id, movements.operatorId))
    .where(inArray(movements.id, ids));
  const lines = await db.select().from(movementLines).where(inArray(movementLines.movementId, ids));
  const voids = await db
    .select({ id: movements.id, reverses: movements.reversesMovementId })
    .from(movements)
    .where(inArray(movements.reversesMovementId, ids));
  const voidedBy = new Map(voids.map((v) => [v.reverses!, v.id]));

  const byId = new Map(
    rows.map(({ m, code, operatorName }) => [
      m.id,
      {
        id: m.id,
        eventId: m.eventId,
        type: m.type,
        paymentMethod: m.paymentMethod,
        amountCents: m.amountCents,
        paidDeltaCents: m.paidDeltaCents,
        promoDeltaCents: m.promoDeltaCents,
        depositDeltaCents: m.depositDeltaCents,
        wristbandId: m.wristbandId,
        wristbandCode: code,
        vendorId: m.vendorId,
        pointOfSaleId: m.pointOfSaleId,
        terminalId: m.terminalId,
        operatorId: m.operatorId,
        operatorName,
        reversesMovementId: m.reversesMovementId,
        voidedByMovementId: voidedBy.get(m.id) ?? null,
        reason: m.reason,
        createdAt: m.createdAt.toISOString(),
        lines: lines
          .filter((l) => l.movementId === m.id)
          .sort((a, b) => a.id - b.id)
          .map((l) => ({
            productId: l.productId,
            name: l.name,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            vatRateBps: l.vatRateBps,
            totalCents: l.totalCents,
          })),
      } satisfies Movement,
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((m): m is Movement => m !== undefined);
}

export async function loadMovement(db: Queryable, id: string): Promise<Movement> {
  const [movement] = await loadMovements(db, [id]);
  if (!movement) throw new Error(`Moviment ${id} no trobat`);
  return movement;
}

// ---------- Paginació per cursor ----------

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

export async function listMovements(
  db: Queryable,
  filter: SQL,
  options: { limit: number; cursor?: string },
): Promise<Page<Movement>> {
  const conditions: SQL[] = [filter];
  const after = options.cursor ? decodeCursor(options.cursor) : null;
  if (after) {
    conditions.push(
      or(lt(movements.createdAt, after.createdAt), and(eq(movements.createdAt, after.createdAt), lt(movements.id, after.id)))!,
    );
  }
  const rows = await db
    .select({ id: movements.id, createdAt: movements.createdAt })
    .from(movements)
    .where(and(...conditions))
    .orderBy(desc(movements.createdAt), desc(movements.id))
    .limit(options.limit + 1);
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    items: await loadMovements(
      db,
      page.map((r) => r.id),
    ),
    nextCursor: rows.length > options.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

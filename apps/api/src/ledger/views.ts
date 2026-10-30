/** Lectura de moviments i saldos en el format de l'API. */
import { Buffer } from 'node:buffer';
import { and, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { Balance, Movement, Page } from '@cashless/shared';
import type { Queryable } from '../db/db';
import { movementLines, movements, operators, wallets, wristbands, type WalletRow, type WristbandRow } from '../db/schema';

/**
 * L'estat que veu una entitat combina el de la polsera (global, p. ex. perduda)
 * i el del seu saldo (bloqueig propi de l'entitat).
 */
export function toBalance(
  wristband: WristbandRow,
  wallet: Pick<WalletRow, 'paidCents' | 'promoCents' | 'depositCents' | 'status'> | null,
  activatedInEvent: boolean,
): Balance {
  const paidCents = wallet?.paidCents ?? 0;
  const promoCents = wallet?.promoCents ?? 0;
  const status = wristband.status !== 'active' ? wristband.status : (wallet?.status ?? 'active');
  return {
    wristbandId: wristband.id,
    code: wristband.code,
    status,
    paidCents,
    promoCents,
    depositCents: wallet?.depositCents ?? 0,
    // Amb deute (pagat negatiu) no es pot gastar res fins que es recarregui.
    availableCents: status === 'active' && paidCents >= 0 ? paidCents + promoCents : 0,
    debtCents: Math.max(0, -paidCents),
    activatedInEvent,
  };
}

/** Una polsera està activada en un esdeveniment si s'hi ha registrat el moviment de preu de polsera. */
export async function isActivatedInEvent(db: Queryable, walletId: string, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(and(eq(movements.walletId, walletId), eq(movements.eventId, eventId), eq(movements.type, 'wristband_fee')))
    .limit(1);
  return row !== undefined;
}

export async function loadBalance(db: Queryable, wristband: WristbandRow, event: { id: string; organizationId: string }): Promise<Balance> {
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.wristbandId, wristband.id), eq(wallets.organizationId, event.organizationId)))
    .limit(1);
  const activated = wallet ? await isActivatedInEvent(db, wallet.id, event.id) : false;
  return toBalance(wristband, wallet ?? null, activated);
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
        offline: m.offline,
        offlineIssues: m.offlineIssues as Movement['offlineIssues'],
        clientCreatedAt: m.clientCreatedAt?.toISOString() ?? null,
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
  const validId = id !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return validId && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
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

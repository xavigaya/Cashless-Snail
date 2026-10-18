/**
 * Llibre de moviments: l'única peça que modifica saldos.
 *
 * Regles:
 * - Cada operació es fa dins d'una transacció que bloqueja el saldo (SELECT ... FOR UPDATE).
 * - Cada operació escriu un o més moviments immutables i actualitza la còpia del saldo (wallets).
 * - L'identificador del moviment el genera el client: si una petició es repeteix
 *   (per exemple, perquè es va perdre la resposta), es retorna el resultat original sense duplicar-la.
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  mergeLines,
  priceLines,
  splitDebit,
  type ActivationInput,
  type ActivationResult,
  type Balance,
  type MovementType,
  type OperationResult,
  type PaymentMethod,
  type SaleInput,
  type TopupInput,
  type VoidInput,
  type WristbandRef,
} from '@cashless/shared';
import { deriveUuid, generateWristbandCode, sha256, stableStringify } from '../common/crypto';
import { conflict, DomainError, forbidden, notFound, unprocessable } from '../common/errors';
import { DB, isUniqueViolation, type Db, type Queryable, type Tx } from '../db/db';
import {
  movementLines,
  movements,
  products,
  wallets,
  wristbands,
  type EventRow,
  type WalletRow,
  type WristbandRow,
} from '../db/schema';
import { loadBalance, loadMovement, loadMovements, toBalance } from './views';

/** Qui fa l'operació i on. */
export interface OperationContext {
  event: EventRow;
  pointOfSaleId: string | null;
  vendorId: string | null;
  terminalId: string | null;
  operatorId: string | null;
  adminUserId: string | null;
}

export interface VoidConstraints {
  allowedTypes: readonly MovementType[];
  /** Si s'indica, només es poden anul·lar moviments fets en aquest punt de venda. */
  pointOfSaleId?: string;
}

interface NewMovement {
  id: string;
  /** Hash de la petició original, per detectar reintents i conflictes. */
  requestHash: string;
  type: MovementType;
  paymentMethod: PaymentMethod;
  amountCents: number;
  paidDeltaCents?: number;
  promoDeltaCents?: number;
  depositDeltaCents?: number;
  reversesMovementId?: string;
  reason?: string;
  vendorId?: string | null;
  pointOfSaleId?: string | null;
  clientCreatedAt?: Date;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---------------------------------------------------------------
  // Consultes
  // ---------------------------------------------------------------

  async findWristband(db: Queryable, ref: WristbandRef): Promise<WristbandRow | null> {
    const condition = ref.uid !== undefined ? eq(wristbands.uid, ref.uid) : eq(wristbands.code, ref.code!);
    const [row] = await db.select().from(wristbands).where(condition).limit(1);
    return row ?? null;
  }

  async balance(organizationId: string, ref: WristbandRef): Promise<Balance> {
    const wristband = await this.findWristband(this.db, ref);
    if (!wristband) throw new DomainError('WRISTBAND_NOT_FOUND', 'Polsera no registrada', HttpStatus.NOT_FOUND);
    return loadBalance(this.db, wristband, organizationId);
  }

  // ---------------------------------------------------------------
  // Venda
  // ---------------------------------------------------------------

  async sale(ctx: OperationContext, input: SaleInput): Promise<OperationResult> {
    const lines = mergeLines(input.lines).sort((a, b) => (a.productId < b.productId ? -1 : 1));
    const requestHash = this.hash({ type: 'sale', eventId: ctx.event.id, wristband: input.wristband, lines });

    return this.idempotent(input.id, requestHash, (tx) => this.replaySingle(tx, input.id, ctx), async (tx) => {
      this.assertEventActive(ctx.event);
      if (!ctx.vendorId) throw forbidden('Aquest punt de venda no pot vendre productes');
      const wristband = await this.requireActiveWristband(tx, input.wristband);

      const productRows = await tx
        .select()
        .from(products)
        .where(
          and(
            inArray(
              products.id,
              lines.map((l) => l.productId),
            ),
            eq(products.eventId, ctx.event.id),
            eq(products.vendorId, ctx.vendorId),
            eq(products.active, true),
          ),
        );
      const productById = new Map(productRows.map((p) => [p.id, p]));
      const missing = lines.filter((l) => !productById.has(l.productId)).map((l) => l.productId);
      if (missing.length > 0) {
        throw unprocessable('PRODUCT_UNAVAILABLE', 'Algun producte no està disponible en aquest punt de venda', { productIds: missing });
      }

      const priced = priceLines(
        lines.map((l) => {
          const p = productById.get(l.productId)!;
          return { productId: p.id, name: p.name, quantity: l.quantity, unitPriceCents: p.priceCents, vatRateBps: p.vatRateBps };
        }),
      );

      const wallet = await this.lockWallet(tx, wristband.id, ctx.event.organizationId, false);
      const split = splitDebit(priced.totalCents, wallet?.promoCents ?? 0, wallet?.paidCents ?? 0);
      if (!wallet || !split) {
        throw unprocessable('INSUFFICIENT_BALANCE', 'Saldo insuficient', {
          totalCents: priced.totalCents,
          availableCents: (wallet?.paidCents ?? 0) + (wallet?.promoCents ?? 0),
        });
      }

      const updated = await this.applyDeltas(tx, wallet, { paid: -split.paidCents, promo: -split.promoCents });
      await this.insertMovement(tx, ctx, wallet, {
        id: input.id,
        requestHash,
        type: 'sale',
        paymentMethod: 'wallet',
        amountCents: priced.totalCents,
        paidDeltaCents: -split.paidCents,
        promoDeltaCents: -split.promoCents,
        clientCreatedAt: input.clientCreatedAt,
      });
      await tx.insert(movementLines).values(priced.lines.map((l) => ({ movementId: input.id, ...l })));

      return { movement: await loadMovement(tx, input.id), balance: toBalance(wristband, updated), replayed: false };
    });
  }

  // ---------------------------------------------------------------
  // Recàrrega
  // ---------------------------------------------------------------

  async topup(ctx: OperationContext, input: TopupInput): Promise<OperationResult> {
    const requestHash = this.hash({
      type: 'topup',
      eventId: ctx.event.id,
      wristband: input.wristband,
      amountCents: input.amountCents,
      method: input.method,
    });

    return this.idempotent(input.id, requestHash, (tx) => this.replaySingle(tx, input.id, ctx), async (tx) => {
      this.assertEventActive(ctx.event);
      const wristband = await this.requireActiveWristband(tx, input.wristband);
      const wallet = (await this.lockWallet(tx, wristband.id, ctx.event.organizationId, true))!;

      const resulting = wallet.paidCents + wallet.promoCents + input.amountCents;
      if (resulting > ctx.event.maxBalanceCents) {
        throw unprocessable('MAX_BALANCE_EXCEEDED', 'Se superaria el saldo màxim permès per polsera', {
          maxBalanceCents: ctx.event.maxBalanceCents,
          currentCents: wallet.paidCents + wallet.promoCents,
        });
      }

      const updated = await this.applyDeltas(tx, wallet, { paid: input.amountCents });
      await this.insertMovement(tx, ctx, wallet, {
        id: input.id,
        requestHash,
        type: 'topup',
        paymentMethod: input.method,
        amountCents: input.amountCents,
        paidDeltaCents: input.amountCents,
        vendorId: null,
        clientCreatedAt: input.clientCreatedAt,
      });

      return { movement: await loadMovement(tx, input.id), balance: toBalance(wristband, updated), replayed: false };
    });
  }

  // ---------------------------------------------------------------
  // Activació de polsera (preu i fiança)
  // ---------------------------------------------------------------

  async activate(ctx: OperationContext, input: ActivationInput): Promise<ActivationResult> {
    const depositId = deriveUuid(input.id, 'deposit');
    const requestHash = this.hash({ type: 'activation', eventId: ctx.event.id, wristband: input.wristband, method: input.method });

    const replay = async (tx: Tx): Promise<ActivationResult> => {
      const found = await loadMovements(tx, [input.id, depositId]);
      const wristband = await this.wristbandOf(tx, found[0]!.wristbandId!);
      return { movements: found, balance: await loadBalance(tx, wristband, ctx.event.organizationId), replayed: true };
    };

    return this.idempotent(input.id, requestHash, replay, async (tx) => {
      this.assertEventActive(ctx.event);
      const wristband = await this.findOrCreateWristband(tx, input.wristband);
      if (wristband.status !== 'active') {
        throw unprocessable('WRISTBAND_BLOCKED', 'Aquesta polsera està bloquejada');
      }
      let wallet = (await this.lockWallet(tx, wristband.id, ctx.event.organizationId, true))!;

      const [already] = await tx
        .select({ id: movements.id })
        .from(movements)
        .where(and(eq(movements.walletId, wallet.id), eq(movements.eventId, ctx.event.id), eq(movements.type, 'wristband_fee')))
        .limit(1);
      if (already) throw unprocessable('ALREADY_ACTIVATED', 'Aquesta polsera ja està activada en aquest esdeveniment');

      const price = ctx.event.wristbandPriceCents;
      const deposit = ctx.event.wristbandDepositCents;
      await this.insertMovement(tx, ctx, wallet, {
        id: input.id,
        requestHash,
        type: 'wristband_fee',
        paymentMethod: price > 0 ? input.method : 'none',
        amountCents: price,
        vendorId: null,
        clientCreatedAt: input.clientCreatedAt,
      });
      const ids = [input.id];
      if (deposit > 0) {
        wallet = await this.applyDeltas(tx, wallet, { deposit });
        await this.insertMovement(tx, ctx, wallet, {
          id: depositId,
          requestHash,
          type: 'deposit',
          paymentMethod: input.method,
          amountCents: deposit,
          depositDeltaCents: deposit,
          vendorId: null,
          clientCreatedAt: input.clientCreatedAt,
        });
        ids.push(depositId);
      }

      return { movements: await loadMovements(tx, ids), balance: toBalance(wristband, wallet), replayed: false };
    });
  }

  // ---------------------------------------------------------------
  // Anul·lació (moviment invers)
  // ---------------------------------------------------------------

  async void(ctx: OperationContext, input: VoidInput, constraints: VoidConstraints): Promise<OperationResult> {
    const requestHash = this.hash({ type: 'void', eventId: ctx.event.id, movementId: input.movementId });

    return this.idempotent(input.id, requestHash, (tx) => this.replaySingle(tx, input.id, ctx), async (tx) => {
      const [target] = await tx.select().from(movements).where(eq(movements.id, input.movementId)).limit(1);
      if (!target || target.eventId !== ctx.event.id) throw notFound('Moviment');
      if (!constraints.allowedTypes.includes(target.type) || !target.walletId) {
        throw unprocessable('NOT_VOIDABLE', 'Aquest tipus de moviment no es pot anul·lar');
      }
      if (constraints.pointOfSaleId && target.pointOfSaleId !== constraints.pointOfSaleId) {
        throw forbidden('Només pots anul·lar moviments del teu punt de venda');
      }
      const [existingVoid] = await tx
        .select({ id: movements.id })
        .from(movements)
        .where(eq(movements.reversesMovementId, target.id))
        .limit(1);
      if (existingVoid) throw conflict('ALREADY_VOIDED', 'Aquest moviment ja està anul·lat');

      const [wallet] = await tx.select().from(wallets).where(eq(wallets.id, target.walletId)).for('update');
      const deltas = { paid: -target.paidDeltaCents, promo: -target.promoDeltaCents, deposit: -target.depositDeltaCents };
      if (wallet!.paidCents + deltas.paid < 0 || wallet!.promoCents + deltas.promo < 0 || wallet!.depositCents + deltas.deposit < 0) {
        throw unprocessable('INSUFFICIENT_BALANCE', 'No hi ha prou saldo per anul·lar aquest moviment: ja s’ha gastat');
      }

      const updated = await this.applyDeltas(tx, wallet!, deltas);
      await this.insertMovement(tx, ctx, wallet!, {
        id: input.id,
        requestHash,
        type: 'void',
        paymentMethod: target.paymentMethod,
        amountCents: target.amountCents,
        paidDeltaCents: deltas.paid,
        promoDeltaCents: deltas.promo,
        depositDeltaCents: deltas.deposit,
        reversesMovementId: target.id,
        reason: input.reason,
        vendorId: target.vendorId,
        pointOfSaleId: target.pointOfSaleId,
      });
      const wristband = await this.wristbandOf(tx, wallet!.wristbandId);
      return { movement: await loadMovement(tx, input.id), balance: toBalance(wristband, updated), replayed: false };
    });
  }

  // ---------------------------------------------------------------
  // Peces internes
  // ---------------------------------------------------------------

  private hash(value: unknown): string {
    return sha256(stableStringify(value));
  }

  /**
   * Executa una operació una sola vegada per identificador de moviment.
   * Si el moviment ja existeix amb la mateixa petició, en retorna el resultat; si la petició és diferent, és un conflicte.
   */
  private async idempotent<T>(
    id: string,
    requestHash: string,
    replay: (tx: Tx) => Promise<T>,
    perform: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const attempt = () =>
      this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ requestHash: movements.requestHash })
          .from(movements)
          .where(eq(movements.id, id))
          .limit(1);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw conflict('MOVEMENT_CONFLICT', 'Aquest identificador ja s’ha fet servir per a una operació diferent');
          }
          return replay(tx);
        }
        return perform(tx);
      });

    try {
      return await attempt();
    } catch (error) {
      // Dues peticions iguals alhora: la segona troba el moviment ja creat i en retorna el resultat.
      if (isUniqueViolation(error, 'movements_pkey')) return attempt();
      if (isUniqueViolation(error, 'movements_reverses_movement_id_key')) {
        throw conflict('ALREADY_VOIDED', 'Aquest moviment ja està anul·lat');
      }
      throw error;
    }
  }

  private async replaySingle(tx: Tx, id: string, ctx: OperationContext): Promise<OperationResult> {
    const movement = await loadMovement(tx, id);
    const wristband = await this.wristbandOf(tx, movement.wristbandId!);
    return { movement, balance: await loadBalance(tx, wristband, ctx.event.organizationId), replayed: true };
  }

  private assertEventActive(event: EventRow): void {
    if (event.status !== 'active') {
      throw unprocessable('EVENT_NOT_ACTIVE', 'L’esdeveniment no està actiu');
    }
  }

  private async requireActiveWristband(tx: Tx, ref: WristbandRef): Promise<WristbandRow> {
    const wristband = await this.findWristband(tx, ref);
    if (!wristband) throw new DomainError('WRISTBAND_NOT_FOUND', 'Polsera no registrada: cal activar-la a la taquilla', HttpStatus.NOT_FOUND);
    if (wristband.status !== 'active') throw unprocessable('WRISTBAND_BLOCKED', 'Aquesta polsera està bloquejada');
    return wristband;
  }

  private async wristbandOf(tx: Tx, id: string): Promise<WristbandRow> {
    const [row] = await tx.select().from(wristbands).where(eq(wristbands.id, id)).limit(1);
    return row!;
  }

  private async findOrCreateWristband(tx: Tx, ref: WristbandRef): Promise<WristbandRow> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.findWristband(tx, ref);
      if (existing) return existing;
      const values = ref.uid !== undefined ? { uid: ref.uid, code: generateWristbandCode() } : { uid: null, code: ref.code! };
      // ON CONFLICT DO NOTHING cobreix tant l'UID com el codi (si el codi generat ja existís, es reintenta).
      await tx.insert(wristbands).values(values).onConflictDoNothing();
    }
    throw new Error('No s’ha pogut registrar la polsera');
  }

  /** Bloqueja el saldo de la polsera per a aquesta entitat. Si `create`, el crea si no existeix. */
  private async lockWallet(tx: Tx, wristbandId: string, organizationId: string, create: boolean): Promise<WalletRow | null> {
    if (create) {
      await tx.insert(wallets).values({ wristbandId, organizationId }).onConflictDoNothing();
    }
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(and(eq(wallets.wristbandId, wristbandId), eq(wallets.organizationId, organizationId)))
      .for('update');
    return wallet ?? null;
  }

  private async applyDeltas(tx: Tx, wallet: WalletRow, d: { paid?: number; promo?: number; deposit?: number }): Promise<WalletRow> {
    const [updated] = await tx
      .update(wallets)
      .set({
        paidCents: sql`${wallets.paidCents} + ${d.paid ?? 0}`,
        promoCents: sql`${wallets.promoCents} + ${d.promo ?? 0}`,
        depositCents: sql`${wallets.depositCents} + ${d.deposit ?? 0}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id))
      .returning();
    return updated!;
  }

  private async insertMovement(tx: Tx, ctx: OperationContext, wallet: WalletRow, m: NewMovement): Promise<void> {
    await tx.insert(movements).values({
      id: m.id,
      eventId: ctx.event.id,
      organizationId: ctx.event.organizationId,
      walletId: wallet.id,
      wristbandId: wallet.wristbandId,
      type: m.type,
      paymentMethod: m.paymentMethod,
      amountCents: m.amountCents,
      paidDeltaCents: m.paidDeltaCents ?? 0,
      promoDeltaCents: m.promoDeltaCents ?? 0,
      depositDeltaCents: m.depositDeltaCents ?? 0,
      vendorId: m.vendorId === undefined ? ctx.vendorId : m.vendorId,
      pointOfSaleId: m.pointOfSaleId === undefined ? ctx.pointOfSaleId : m.pointOfSaleId,
      terminalId: ctx.terminalId,
      operatorId: ctx.operatorId,
      adminUserId: ctx.adminUserId,
      reversesMovementId: m.reversesMovementId ?? null,
      reason: m.reason ?? null,
      requestHash: m.requestHash,
      clientCreatedAt: m.clientCreatedAt ?? null,
    });
  }
}

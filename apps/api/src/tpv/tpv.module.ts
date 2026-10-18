import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Module, Post, Query, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  activationSchema,
  operatorLoginSchema,
  pairTerminalSchema,
  saleSchema,
  topupSchema,
  voidSchema,
  wristbandRefSchema,
  type ActivationInput,
  type ActivationResult,
  type Balance,
  type Movement,
  type OperationResult,
  type OperatorLoginInput,
  type OperatorSession,
  type PairResult,
  type PairTerminalInput,
  type Product,
  type SaleInput,
  type TerminalContext,
  type TopupInput,
  type VoidInput,
  type WristbandRef,
} from '@cashless/shared';
import { randomToken, sha256, verifySecret } from '../common/crypto';
import { DomainError, forbidden, notFound, ZodPipe } from '../common/errors';
import { DB, type Db } from '../db/db';
import { events, movements, operators, pointsOfSale, products, terminals } from '../db/schema';
import { assertOperatorRole, OperatorGuard, TerminalGuard, type OperatorTokenPayload } from '../auth/guards';
import {
  BOX_OFFICE_ROLES,
  CurrentOperator,
  CurrentTerminal,
  SALE_ROLES,
  VOID_ROLES,
  type OperatorPrincipal,
  type TerminalPrincipal,
} from '../auth/principals';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService, type OperationContext } from '../ledger/ledger.service';
import { listMovements } from '../ledger/views';
import { toProduct } from '../admin/mappers';

const OPERATOR_SESSION_HOURS = 12;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 5;

@Injectable()
export class TpvService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly ledger: LedgerService,
  ) {}

  async pair(input: PairTerminalInput): Promise<PairResult> {
    const token = randomToken();
    // Una sola actualització condicional: si dos dispositius fan servir el mateix codi alhora,
    // només un el consumeix i l'altre rep un error (no queda cap dispositiu amb un token invàlid).
    const [terminal] = await this.db
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
      throw new DomainError('INVALID_PAIRING_CODE', 'Codi de vinculació incorrecte o caducat', HttpStatus.UNAUTHORIZED);
    }
    return { terminalToken: token, context: await this.context(terminal.id) };
  }

  async context(terminalId: string): Promise<TerminalContext> {
    const [row] = await this.db
      .select({ terminal: terminals, pos: pointsOfSale, event: events })
      .from(terminals)
      .innerJoin(pointsOfSale, eq(pointsOfSale.id, terminals.pointOfSaleId))
      .innerJoin(events, eq(events.id, terminals.eventId))
      .where(eq(terminals.id, terminalId))
      .limit(1);
    if (!row) throw notFound('Terminal');

    // Les taquilles només mostren taquillers; les barres, la resta de rols.
    const allowedRoles = row.pos.kind === 'box_office' ? BOX_OFFICE_ROLES : SALE_ROLES;
    const ops = await this.db
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

  async login(terminal: TerminalPrincipal, input: OperatorLoginInput): Promise<OperatorSession> {
    const [operator] = await this.db
      .select()
      .from(operators)
      .where(and(eq(operators.id, input.operatorId), eq(operators.eventId, terminal.eventId), eq(operators.active, true)))
      .limit(1);
    if (!operator) throw new DomainError('INVALID_PIN', 'PIN incorrecte', HttpStatus.UNAUTHORIZED);
    if (operator.lockedUntil && operator.lockedUntil > new Date()) {
      throw new DomainError('OPERATOR_LOCKED', 'Massa intents fallits: espera uns minuts', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (!(await verifySecret(input.pin, operator.pinHash))) {
      // Increment atòmic: diverses peticions en paral·lel no poden saltar-se el límit d'intents.
      const [counted] = await this.db
        .update(operators)
        .set({ failedAttempts: sql`${operators.failedAttempts} + 1` })
        .where(eq(operators.id, operator.id))
        .returning({ failedAttempts: operators.failedAttempts });
      if ((counted?.failedAttempts ?? 0) >= MAX_PIN_ATTEMPTS) {
        await this.db
          .update(operators)
          .set({ failedAttempts: 0, lockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) })
          .where(eq(operators.id, operator.id));
      }
      throw new DomainError('INVALID_PIN', 'PIN incorrecte', HttpStatus.UNAUTHORIZED);
    }
    if (operator.failedAttempts > 0 || operator.lockedUntil) {
      await this.db.update(operators).set({ failedAttempts: 0, lockedUntil: null }).where(eq(operators.id, operator.id));
    }

    // El rol es comprova després del PIN, perquè sense PIN no es pugui saber el rol de ningú.
    const allowed = terminal.posKind === 'box_office' ? BOX_OFFICE_ROLES : SALE_ROLES;
    assertOperatorRole(operator.role, allowed);

    const payload: OperatorTokenPayload = { sub: operator.id, kind: 'operator', terminalId: terminal.id, eventId: terminal.eventId };
    const token = await this.jwt.signAsync(payload, { expiresIn: `${OPERATOR_SESSION_HOURS}h` });
    return {
      token,
      operator: { id: operator.id, name: operator.name, role: operator.role },
      expiresAt: new Date(Date.now() + OPERATOR_SESSION_HOURS * 3_600_000).toISOString(),
    };
  }

  async catalog(terminal: TerminalPrincipal): Promise<Product[]> {
    if (!terminal.vendorId) return [];
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.eventId, terminal.eventId), eq(products.vendorId, terminal.vendorId), eq(products.active, true)))
      .orderBy(asc(products.sortOrder), asc(products.name));
    return rows.map(toProduct);
  }

  async operationContext(terminal: TerminalPrincipal, operator: OperatorPrincipal): Promise<OperationContext> {
    const [event] = await this.db.select().from(events).where(eq(events.id, terminal.eventId)).limit(1);
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

  balance(terminal: TerminalPrincipal, ref: WristbandRef): Promise<Balance> {
    return this.ledger.balance(terminal.organizationId, ref);
  }

  async recent(terminal: TerminalPrincipal): Promise<Movement[]> {
    const page = await listMovements(this.db, eq(movements.terminalId, terminal.id), { limit: 20 });
    return page.items;
  }
}

/**
 * Endpoints que fan servir els terminals.
 * Tots (excepte /pair) necessiten la capçalera X-Terminal-Token.
 * Les operacions, a més, necessiten la sessió de l'operador (Authorization: Bearer).
 */
@Controller('tpv')
export class TpvController {
  constructor(
    private readonly tpv: TpvService,
    private readonly ledger: LedgerService,
  ) {}

  @Post('pair')
  @HttpCode(200)
  pair(@Body(new ZodPipe(pairTerminalSchema)) body: PairTerminalInput): Promise<PairResult> {
    return this.tpv.pair(body);
  }

  @Get('context')
  @UseGuards(TerminalGuard)
  context(@CurrentTerminal() terminal: TerminalPrincipal): Promise<TerminalContext> {
    return this.tpv.context(terminal.id);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(TerminalGuard)
  login(
    @CurrentTerminal() terminal: TerminalPrincipal,
    @Body(new ZodPipe(operatorLoginSchema)) body: OperatorLoginInput,
  ): Promise<OperatorSession> {
    return this.tpv.login(terminal, body);
  }

  @Get('catalog')
  @UseGuards(TerminalGuard, OperatorGuard)
  catalog(@CurrentTerminal() terminal: TerminalPrincipal): Promise<Product[]> {
    return this.tpv.catalog(terminal);
  }

  @Get('balance')
  @UseGuards(TerminalGuard, OperatorGuard)
  balance(@CurrentTerminal() terminal: TerminalPrincipal, @Query(new ZodPipe(wristbandRefSchema)) ref: WristbandRef): Promise<Balance> {
    return this.tpv.balance(terminal, ref);
  }

  @Get('recent')
  @UseGuards(TerminalGuard, OperatorGuard)
  recent(@CurrentTerminal() terminal: TerminalPrincipal): Promise<Movement[]> {
    return this.tpv.recent(terminal);
  }

  @Post('sales')
  @UseGuards(TerminalGuard, OperatorGuard)
  async sale(
    @CurrentTerminal() terminal: TerminalPrincipal,
    @CurrentOperator() operator: OperatorPrincipal,
    @Body(new ZodPipe(saleSchema)) body: SaleInput,
  ): Promise<OperationResult> {
    if (terminal.posKind === 'box_office') throw forbidden('Una taquilla no pot vendre productes');
    assertOperatorRole(operator.role, SALE_ROLES);
    return this.ledger.sale(await this.tpv.operationContext(terminal, operator), body);
  }

  @Post('topups')
  @UseGuards(TerminalGuard, OperatorGuard)
  async topup(
    @CurrentTerminal() terminal: TerminalPrincipal,
    @CurrentOperator() operator: OperatorPrincipal,
    @Body(new ZodPipe(topupSchema)) body: TopupInput,
  ): Promise<OperationResult> {
    if (terminal.posKind !== 'box_office') throw forbidden('Les recàrregues es fan a la taquilla');
    assertOperatorRole(operator.role, BOX_OFFICE_ROLES);
    return this.ledger.topup(await this.tpv.operationContext(terminal, operator), body);
  }

  @Post('activations')
  @UseGuards(TerminalGuard, OperatorGuard)
  async activate(
    @CurrentTerminal() terminal: TerminalPrincipal,
    @CurrentOperator() operator: OperatorPrincipal,
    @Body(new ZodPipe(activationSchema)) body: ActivationInput,
  ): Promise<ActivationResult> {
    if (terminal.posKind !== 'box_office') throw forbidden('Les polseres s’activen a la taquilla');
    assertOperatorRole(operator.role, BOX_OFFICE_ROLES);
    return this.ledger.activate(await this.tpv.operationContext(terminal, operator), body);
  }

  @Post('voids')
  @UseGuards(TerminalGuard, OperatorGuard)
  async void(
    @CurrentTerminal() terminal: TerminalPrincipal,
    @CurrentOperator() operator: OperatorPrincipal,
    @Body(new ZodPipe(voidSchema)) body: VoidInput,
  ): Promise<OperationResult> {
    assertOperatorRole(operator.role, VOID_ROLES);
    return this.ledger.void(await this.tpv.operationContext(terminal, operator), body, {
      allowedTypes: ['sale'],
      pointOfSaleId: terminal.pointOfSaleId,
    });
  }
}

@Module({
  imports: [LedgerModule],
  controllers: [TpvController],
  providers: [TpvService],
})
export class TpvModule {}

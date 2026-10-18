import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  createOperatorSchema,
  createTerminalSchema,
  updateOperatorSchema,
  updateTerminalSchema,
  type CreateOperatorInput,
  type CreateTerminalInput,
  type Operator,
  type Terminal,
  type UpdateOperatorInput,
  type UpdateTerminalInput,
} from '@cashless/shared';
import { generatePairingCode, hashSecret } from '../common/crypto';
import { notFound, unprocessable, ZodPipe } from '../common/errors';
import { DB, type Db } from '../db/db';
import { operators, pointsOfSale, terminals } from '../db/schema';
import { AdminGuard } from '../auth/guards';
import { CurrentAdmin, type AdminPrincipal } from '../auth/principals';
import { AdminAccessService } from './admin-access.service';
import { toOperator, toTerminal } from './mappers';

const PAIRING_MINUTES = 30;

/** Operadors (voluntaris amb PIN) i terminals d'un esdeveniment. */
@Controller('events/:eventId')
@UseGuards(AdminGuard)
export class StaffController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AdminAccessService,
  ) {}

  // ---------- Operadors ----------

  @Get('operators')
  async operators(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<Operator[]> {
    await this.access.event(admin, eventId);
    return (await this.db.select().from(operators).where(eq(operators.eventId, eventId)).orderBy(asc(operators.name))).map(toOperator);
  }

  @Post('operators')
  async createOperator(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createOperatorSchema)) body: CreateOperatorInput,
  ): Promise<Operator> {
    await this.access.event(admin, eventId);
    const [row] = await this.db
      .insert(operators)
      .values({ eventId, name: body.name, role: body.role, pinHash: await hashSecret(body.pin) })
      .returning();
    return toOperator(row!);
  }

  @Patch('operators/:operatorId')
  async updateOperator(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('operatorId', ParseUUIDPipe) operatorId: string,
    @Body(new ZodPipe(updateOperatorSchema)) body: UpdateOperatorInput,
  ): Promise<Operator> {
    await this.access.event(admin, eventId);
    const { pin, ...rest } = body;
    const changes = pin ? { ...rest, pinHash: await hashSecret(pin), failedAttempts: 0, lockedUntil: null } : rest;
    const [row] = await this.db
      .update(operators)
      .set(changes)
      .where(and(eq(operators.id, operatorId), eq(operators.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Operador');
    return toOperator(row);
  }

  // ---------- Terminals ----------

  @Get('terminals')
  async terminals(@CurrentAdmin() admin: AdminPrincipal, @Param('eventId', ParseUUIDPipe) eventId: string): Promise<Terminal[]> {
    await this.access.event(admin, eventId);
    return (await this.db.select().from(terminals).where(eq(terminals.eventId, eventId)).orderBy(asc(terminals.name))).map(toTerminal);
  }

  /** Crea un terminal amb un codi de vinculació vàlid durant 30 minuts. */
  @Post('terminals')
  async createTerminal(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ZodPipe(createTerminalSchema)) body: CreateTerminalInput,
  ): Promise<Terminal> {
    await this.access.event(admin, eventId);
    await this.assertPointOfSaleInEvent(eventId, body.pointOfSaleId);
    const [row] = await this.db
      .insert(terminals)
      .values({ eventId, name: body.name, pointOfSaleId: body.pointOfSaleId, ...this.newPairing() })
      .returning();
    await this.access.audit(this.db, admin, { eventId, action: 'terminal.create', targetType: 'terminal', targetId: row!.id });
    return toTerminal(row!);
  }

  @Patch('terminals/:terminalId')
  async updateTerminal(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('terminalId', ParseUUIDPipe) terminalId: string,
    @Body(new ZodPipe(updateTerminalSchema)) body: UpdateTerminalInput,
  ): Promise<Terminal> {
    await this.access.event(admin, eventId);
    if (body.pointOfSaleId) await this.assertPointOfSaleInEvent(eventId, body.pointOfSaleId);
    const [row] = await this.db
      .update(terminals)
      .set(body)
      .where(and(eq(terminals.id, terminalId), eq(terminals.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Terminal');
    if (body.active === false) {
      await this.access.audit(this.db, admin, { eventId, action: 'terminal.disable', targetType: 'terminal', targetId: terminalId });
    }
    return toTerminal(row);
  }

  /**
   * Genera un codi nou per vincular el terminal a un dispositiu.
   * El dispositiu anterior continua funcionant fins que se'n vinculi un de nou.
   */
  @Post('terminals/:terminalId/pairing-code')
  async newPairingCode(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('terminalId', ParseUUIDPipe) terminalId: string,
  ): Promise<Terminal> {
    await this.access.event(admin, eventId);
    const [row] = await this.db
      .update(terminals)
      .set(this.newPairing())
      .where(and(eq(terminals.id, terminalId), eq(terminals.eventId, eventId)))
      .returning();
    if (!row) throw notFound('Terminal');
    await this.access.audit(this.db, admin, { eventId, action: 'terminal.pairing_code', targetType: 'terminal', targetId: terminalId });
    return toTerminal(row);
  }

  private newPairing(): { pairingCode: string; pairingExpiresAt: Date } {
    return { pairingCode: generatePairingCode(), pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60_000) };
  }

  private async assertPointOfSaleInEvent(eventId: string, posId: string): Promise<void> {
    const [pos] = await this.db
      .select({ id: pointsOfSale.id })
      .from(pointsOfSale)
      .where(and(eq(pointsOfSale.id, posId), eq(pointsOfSale.eventId, eventId)))
      .limit(1);
    if (!pos) throw unprocessable('VALIDATION_ERROR', 'El punt de venda no pertany a aquest esdeveniment');
  }
}

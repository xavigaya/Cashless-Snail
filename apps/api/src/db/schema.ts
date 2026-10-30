/**
 * Definició de les taules per a Drizzle ORM.
 * Ha de coincidir amb les migracions SQL de /migrations, que són la font de veritat de l'esquema.
 */
import { sql } from 'drizzle-orm';
import { bigserial, boolean, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  AdminRole,
  EventStatus,
  MovementType,
  OperatorRole,
  PaymentMethod,
  PosKind,
  TaxRegime,
  WristbandStatus,
} from '@cashless/shared';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  taxId: text('tax_id'),
  taxRegime: text('tax_regime').$type<TaxRegime>().notNull(),
  createdAt: createdAt(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  /** Bloqueig per massa contrasenyes errònies (migració 0004). */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  createdAt: createdAt(),
});

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').$type<EventStatus>().notNull().default('draft'),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  wristbandPriceCents: integer('wristband_price_cents').notNull().default(0),
  wristbandDepositCents: integer('wristband_deposit_cents').notNull().default(0),
  maxBalanceCents: integer('max_balance_cents').notNull().default(50000),
  /** Import màxim per venda sense connexió; 0 = no es pot vendre sense connexió (migració 0005). */
  offlineSaleLimitCents: integer('offline_sale_limit_cents').notNull().default(2000),
  createdAt: createdAt(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const roleAssignments = pgTable('role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => adminUsers.id),
  role: text('role').$type<AdminRole>().notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  eventId: uuid('event_id').references(() => events.id),
  createdAt: createdAt(),
});

export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  name: text('name').notNull(),
  commissionBps: integer('commission_bps').notNull().default(0),
  createdAt: createdAt(),
});

export const pointsOfSale = pgTable('points_of_sale', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  name: text('name').notNull(),
  kind: text('kind').$type<PosKind>().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  vendorId: uuid('vendor_id')
    .notNull()
    .references(() => vendors.id),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  vatRateBps: integer('vat_rate_bps').notNull().default(1000),
  category: text('category').notNull().default('General'),
  color: text('color').notNull().default('#3B6FB6'),
  sortOrder: integer('sort_order').notNull().default(0),
  destination: text('destination').$type<'bar' | 'kitchen'>().notNull().default('bar'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  name: text('name').notNull(),
  pinHash: text('pin_hash').notNull(),
  role: text('role').$type<OperatorRole>().notNull(),
  active: boolean('active').notNull().default(true),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  createdAt: createdAt(),
});

export const terminals = pgTable('terminals', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  pointOfSaleId: uuid('point_of_sale_id')
    .notNull()
    .references(() => pointsOfSale.id),
  name: text('name').notNull(),
  deviceName: text('device_name'),
  tokenHash: text('token_hash').unique(),
  pairingCode: text('pairing_code').unique(),
  pairingExpiresAt: tstz('pairing_expires_at'),
  pairedAt: tstz('paired_at'),
  lastSeenAt: tstz('last_seen_at'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const wristbands = pgTable('wristbands', {
  id: uuid('id').primaryKey().defaultRandom(),
  uid: text('uid').unique(),
  code: text('code').notNull().unique(),
  status: text('status').$type<WristbandStatus>().notNull().default('active'),
  createdAt: createdAt(),
});

/** Torns de caixa de les taquilles (migració 0005). */
export const cashShifts = pgTable('cash_shifts', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  terminalId: uuid('terminal_id')
    .notNull()
    .references(() => terminals.id),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id),
  openingFloatCents: integer('opening_float_cents').notNull(),
  openedAt: tstz('opened_at').notNull().defaultNow(),
  closedAt: tstz('closed_at'),
  closedByOperatorId: uuid('closed_by_operator_id').references(() => operators.id),
  closedByAdminId: uuid('closed_by_admin_id').references(() => adminUsers.id),
  declaredCashCents: integer('declared_cash_cents'),
  expectedCashCents: integer('expected_cash_cents'),
  note: text('note'),
});

export const wallets = pgTable('wallets', {
  id: uuid('id').primaryKey().defaultRandom(),
  wristbandId: uuid('wristband_id')
    .notNull()
    .references(() => wristbands.id),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  /** Pot ser negatiu: deute d'una venda feta sense connexió (migració 0005). */
  paidCents: integer('paid_cents').notNull().default(0),
  promoCents: integer('promo_cents').notNull().default(0),
  depositCents: integer('deposit_cents').notNull().default(0),
  /** Bloqueig propi d'aquesta entitat (migració 0002). */
  status: text('status').$type<WristbandStatus>().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const movements = pgTable('movements', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id),
  walletId: uuid('wallet_id').references(() => wallets.id),
  wristbandId: uuid('wristband_id').references(() => wristbands.id),
  type: text('type').$type<MovementType>().notNull(),
  paymentMethod: text('payment_method').$type<PaymentMethod>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidDeltaCents: integer('paid_delta_cents').notNull().default(0),
  promoDeltaCents: integer('promo_delta_cents').notNull().default(0),
  depositDeltaCents: integer('deposit_delta_cents').notNull().default(0),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  pointOfSaleId: uuid('point_of_sale_id').references(() => pointsOfSale.id),
  terminalId: uuid('terminal_id').references(() => terminals.id),
  operatorId: uuid('operator_id').references(() => operators.id),
  adminUserId: uuid('admin_user_id').references(() => adminUsers.id),
  reversesMovementId: uuid('reverses_movement_id')
    .unique()
    .references((): AnyPgColumn => movements.id),
  reason: text('reason'),
  requestHash: text('request_hash').notNull(),
  clientCreatedAt: tstz('client_created_at'),
  /** Venda feta sense connexió i sincronitzada després (migració 0005). */
  offline: boolean('offline').notNull().default(false),
  /** Problemes que s'haurien detectat amb connexió (codis d'ERROR_CODES). */
  offlineIssues: text('offline_issues').array().notNull().default(sql`'{}'::text[]`),
  shiftId: uuid('shift_id').references(() => cashShifts.id),
  createdAt: createdAt(),
});

export const movementLines = pgTable('movement_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  movementId: uuid('movement_id')
    .notNull()
    .references(() => movements.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  vatRateBps: integer('vat_rate_bps').notNull(),
  totalCents: integer('total_cents').notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorType: text('actor_type').$type<'admin' | 'operator' | 'terminal' | 'system'>().notNull(),
  actorId: uuid('actor_id'),
  eventId: uuid('event_id').references(() => events.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  data: jsonb('data'),
  createdAt: createdAt(),
});

export type EventRow = typeof events.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type TerminalRow = typeof terminals.$inferSelect;
export type OperatorRow = typeof operators.$inferSelect;
export type WristbandRow = typeof wristbands.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type MovementRow = typeof movements.$inferSelect;
export type MovementLineRow = typeof movementLines.$inferSelect;
export type CashShiftRow = typeof cashShifts.$inferSelect;

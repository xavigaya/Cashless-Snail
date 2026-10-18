/**
 * Esquemes de validació de les peticions a l'API.
 * Els fa servir el servidor per validar i els clients per tipar els formularis.
 */
import { z } from 'zod';
import { EVENT_STATUSES, OPERATOR_ROLES, POS_KINDS, TAX_REGIMES } from './enums';
import { isValidCode, isValidUid, normalizeCode, normalizeUid } from './wristband';

const cents = z.number().int().nonnegative();
const positiveCents = z.number().int().positive();
const uuid = z.string().uuid();
const pin = z.string().regex(/^\d{4,6}$/, 'El PIN ha de tenir entre 4 i 6 xifres');
const slug = z
  .string()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Només minúscules, xifres i guions');
const vatRateBps = z.number().int().min(0).max(10000);
const commissionBps = z.number().int().min(0).max(10000);

// ---------- Autenticació ----------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- Entitats ----------

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(120),
  taxId: z.string().max(20).optional(),
  taxRegime: z.enum(TAX_REGIMES),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const createAdminUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  password: z.string().min(10, 'La contrasenya ha de tenir almenys 10 caràcters'),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

// ---------- Esdeveniments ----------

const eventBase = z.object({
  name: z.string().min(2).max(120),
  slug,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  wristbandPriceCents: cents.default(0),
  wristbandDepositCents: cents.default(0),
  maxBalanceCents: positiveCents.default(50000),
});

export const createEventSchema = eventBase.refine((e) => e.endsAt > e.startsAt, {
  message: 'La data de final ha de ser posterior a la d’inici',
  path: ['endsAt'],
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = eventBase
  .omit({ slug: true })
  .partial()
  .extend({ status: z.enum(EVENT_STATUSES).optional() });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// ---------- Venedors i punts de venda ----------

export const createVendorSchema = z.object({
  name: z.string().min(2).max(120),
  organizationId: uuid.optional(),
  commissionBps: commissionBps.default(0),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial();
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const createPointOfSaleSchema = z
  .object({
    name: z.string().min(2).max(80),
    kind: z.enum(POS_KINDS),
    vendorId: uuid.optional(),
  })
  .refine((p) => p.kind === 'box_office' || p.vendorId !== undefined, {
    message: 'Les barres i cuines han de tenir un venedor',
    path: ['vendorId'],
  });
export type CreatePointOfSaleInput = z.infer<typeof createPointOfSaleSchema>;

export const updatePointOfSaleSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  active: z.boolean().optional(),
});
export type UpdatePointOfSaleInput = z.infer<typeof updatePointOfSaleSchema>;

// ---------- Productes ----------

export const createProductSchema = z.object({
  vendorId: uuid,
  name: z.string().min(1).max(60),
  priceCents: positiveCents,
  vatRateBps: vatRateBps.default(1000),
  category: z.string().max(40).default('General'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#3B6FB6'),
  sortOrder: z.number().int().default(0),
  destination: z.enum(['bar', 'kitchen']).default('bar'),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .omit({ vendorId: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ---------- Operadors i terminals ----------

export const createOperatorSchema = z.object({
  name: z.string().min(2).max(60),
  pin,
  role: z.enum(OPERATOR_ROLES),
});
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

export const updateOperatorSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  pin: pin.optional(),
  role: z.enum(OPERATOR_ROLES).optional(),
  active: z.boolean().optional(),
});
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>;

export const createTerminalSchema = z.object({
  name: z.string().min(2).max(60),
  pointOfSaleId: uuid,
});
export type CreateTerminalInput = z.infer<typeof createTerminalSchema>;

export const updateTerminalSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  pointOfSaleId: uuid.optional(),
  active: z.boolean().optional(),
});
export type UpdateTerminalInput = z.infer<typeof updateTerminalSchema>;

export const pairTerminalSchema = z.object({
  pairingCode: z.string().transform((s) => s.trim().toUpperCase()),
  deviceName: z.string().max(80).default('Dispositiu'),
});
export type PairTerminalInput = z.infer<typeof pairTerminalSchema>;

export const operatorLoginSchema = z.object({
  operatorId: uuid,
  pin,
});
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;

// ---------- Operacions de TPV ----------

/** Referència a una polsera: per UID NFC o per codi imprès (QR). */
export const wristbandRefSchema = z
  .object({
    uid: z.string().transform(normalizeUid).refine(isValidUid, 'UID NFC no vàlid').optional(),
    code: z.string().transform(normalizeCode).refine(isValidCode, 'Codi de polsera no vàlid').optional(),
  })
  .refine((w) => (w.uid === undefined) !== (w.code === undefined), {
    message: 'Cal indicar l’UID o el codi de la polsera, però no tots dos',
  });
export type WristbandRef = z.infer<typeof wristbandRefSchema>;

/**
 * L'identificador `id` el genera el terminal (UUID). Serveix per evitar duplicats:
 * si la mateixa petició arriba dues vegades, només es comptabilitza una.
 */
export const saleSchema = z.object({
  id: uuid,
  wristband: wristbandRefSchema,
  lines: z
    .array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  clientCreatedAt: z.coerce.date().optional(),
});
export type SaleInput = z.infer<typeof saleSchema>;

export const topupSchema = z.object({
  id: uuid,
  wristband: wristbandRefSchema,
  amountCents: positiveCents.max(100000),
  method: z.enum(['cash', 'card']),
  clientCreatedAt: z.coerce.date().optional(),
});
export type TopupInput = z.infer<typeof topupSchema>;

export const activationSchema = z.object({
  id: uuid,
  wristband: wristbandRefSchema,
  method: z.enum(['cash', 'card']).default('cash'),
  clientCreatedAt: z.coerce.date().optional(),
});
export type ActivationInput = z.infer<typeof activationSchema>;

export const voidSchema = z.object({
  id: uuid,
  movementId: uuid,
  reason: z.string().min(3).max(200),
});
export type VoidInput = z.infer<typeof voidSchema>;

export const wristbandStatusSchema = z.object({
  status: z.enum(['active', 'blocked', 'lost']),
});
export type WristbandStatusInput = z.infer<typeof wristbandStatusSchema>;

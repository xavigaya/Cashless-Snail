/** Rols dels usuaris del backoffice. S'assignen a un àmbit concret. */
export const ADMIN_ROLES = ['platform_admin', 'org_admin', 'event_manager'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Rols dels operadors que treballen als terminals (entren amb PIN). */
export const OPERATOR_ROLES = ['bar_lead', 'cashier', 'waiter', 'box_office'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  bar_lead: 'Cap de barra',
  cashier: 'Caixer',
  waiter: 'Cambrer',
  box_office: 'Taquiller',
};

/** Tipus de punt de venda. */
export const POS_KINDS = ['bar', 'kitchen', 'box_office'] as const;
export type PosKind = (typeof POS_KINDS)[number];

export const POS_KIND_LABELS: Record<PosKind, string> = {
  bar: 'Barra',
  kitchen: 'Cuina',
  box_office: 'Taquilla',
};

export const EVENT_STATUSES = ['draft', 'active', 'closed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Esborrany',
  active: 'Actiu',
  closed: 'Tancat',
};

export const WRISTBAND_STATUSES = ['active', 'blocked', 'lost'] as const;
export type WristbandStatus = (typeof WRISTBAND_STATUSES)[number];

/**
 * Tipus de moviment del llibre. Cada operació econòmica és un moviment immutable.
 * - topup: recàrrega de saldo pagat
 * - sale: venda (resta saldo)
 * - void: anul·lació d'un moviment anterior (moviment invers)
 * - refund: devolució de saldo pagat a l'usuari
 * - wristband_fee: preu de la polsera (ingrés de l'entitat, no és saldo)
 * - deposit / deposit_return: fiança de la polsera
 * - promo_grant: saldo promocional regalat
 */
export const MOVEMENT_TYPES = [
  'topup',
  'sale',
  'void',
  'refund',
  'wristband_fee',
  'deposit',
  'deposit_return',
  'promo_grant',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  topup: 'Recàrrega',
  sale: 'Venda',
  void: 'Anul·lació',
  refund: 'Devolució',
  wristband_fee: 'Preu de polsera',
  deposit: 'Fiança',
  deposit_return: 'Retorn de fiança',
  promo_grant: 'Saldo regal',
};

export const PAYMENT_METHODS = ['cash', 'card', 'online', 'wallet', 'none'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectiu',
  card: 'Targeta',
  online: 'Online',
  wallet: 'Saldo',
  none: '—',
};

export const TAX_REGIMES = ['association', 'company', 'self_employed', 'public_body'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  association: 'Associació',
  company: 'Societat',
  self_employed: 'Autònom',
  public_body: 'Administració pública',
};

/** Codis d'error de negoci que el servidor retorna i els clients interpreten. */
export const ERROR_CODES = [
  'INSUFFICIENT_BALANCE',
  'WRISTBAND_BLOCKED',
  'WRISTBAND_NOT_FOUND',
  'WRISTBAND_NOT_ACTIVATED',
  'EVENT_NOT_ACTIVE',
  'PRODUCT_UNAVAILABLE',
  'MAX_BALANCE_EXCEEDED',
  'MOVEMENT_CONFLICT',
  'ALREADY_VOIDED',
  'NOT_VOIDABLE',
  'FORBIDDEN_FOR_ROLE',
  'ALREADY_ACTIVATED',
  'INVALID_PIN',
  'OPERATOR_LOCKED',
  'INVALID_PAIRING_CODE',
  'TERMINAL_DISABLED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Formes de les respostes de l'API, compartides amb els clients. */
import type {
  AdminRole,
  ErrorCode,
  EventStatus,
  MovementType,
  OperatorRole,
  PaymentMethod,
  PosKind,
  TaxRegime,
  WristbandStatus,
} from './enums';

export interface ApiError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface RoleAssignment {
  role: AdminRole;
  organizationId: string | null;
  eventId: string | null;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: RoleAssignment[];
}

export interface LoginResult {
  token: string;
  user: Me;
}

export interface Organization {
  id: string;
  name: string;
  taxId: string | null;
  taxRegime: TaxRegime;
  createdAt: string;
}

export interface EventSummary {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
  wristbandPriceCents: number;
  wristbandDepositCents: number;
  maxBalanceCents: number;
  /** Import màxim per venda sense connexió (0 = desactivat). */
  offlineSaleLimitCents: number;
}

export interface Vendor {
  id: string;
  eventId: string;
  organizationId: string | null;
  name: string;
  commissionBps: number;
}

export interface PointOfSale {
  id: string;
  eventId: string;
  vendorId: string | null;
  name: string;
  kind: PosKind;
  active: boolean;
}

export interface Product {
  id: string;
  eventId: string;
  vendorId: string;
  name: string;
  priceCents: number;
  vatRateBps: number;
  category: string;
  color: string;
  sortOrder: number;
  destination: 'bar' | 'kitchen';
  active: boolean;
}

export interface Operator {
  id: string;
  eventId: string;
  name: string;
  role: OperatorRole;
  active: boolean;
}

export interface Terminal {
  id: string;
  eventId: string;
  pointOfSaleId: string;
  name: string;
  deviceName: string | null;
  active: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  /** Només present quan hi ha un codi de vinculació vigent. */
  pairingCode: string | null;
  pairingExpiresAt: string | null;
}

export interface Balance {
  wristbandId: string;
  code: string;
  status: WristbandStatus;
  paidCents: number;
  promoCents: number;
  depositCents: number;
  /** Saldo que es pot gastar ara (pagat + promocional). És 0 si hi ha deute. */
  availableCents: number;
  /** Deute pendent per vendes fetes sense connexió: s'ha de recarregar abans de tornar a comprar. */
  debtCents: number;
  /** Si s'ha pagat l'activació de la polsera en aquest esdeveniment (cal per recarregar i comprar). */
  activatedInEvent: boolean;
}

export interface MovementLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  vatRateBps: number;
  totalCents: number;
}

export interface Movement {
  id: string;
  eventId: string;
  type: MovementType;
  paymentMethod: PaymentMethod;
  amountCents: number;
  paidDeltaCents: number;
  promoDeltaCents: number;
  depositDeltaCents: number;
  wristbandId: string | null;
  wristbandCode: string | null;
  vendorId: string | null;
  pointOfSaleId: string | null;
  terminalId: string | null;
  operatorId: string | null;
  operatorName: string | null;
  reversesMovementId: string | null;
  voidedByMovementId: string | null;
  reason: string | null;
  /** Venda feta sense connexió. */
  offline: boolean;
  /** Problemes que s'haurien detectat amb connexió. */
  offlineIssues: ErrorCode[];
  /** Hora real de l'operació al terminal (en les vendes sense connexió, anterior a createdAt). */
  clientCreatedAt: string | null;
  createdAt: string;
  lines: MovementLine[];
}

export interface OperationResult {
  movement: Movement;
  balance: Balance;
  /** true si la petició ja s'havia processat abans (reintent). */
  replayed: boolean;
}

export interface ActivationResult {
  movements: Movement[];
  balance: Balance;
  replayed: boolean;
}

/** Context que rep el terminal un cop vinculat. */
export interface TerminalContext {
  terminal: { id: string; name: string };
  event: { id: string; name: string; status: EventStatus; wristbandPriceCents: number; wristbandDepositCents: number; offlineSaleLimitCents: number };
  pointOfSale: { id: string; name: string; kind: PosKind };
  operators: { id: string; name: string; role: OperatorRole }[];
}

export interface PairResult {
  terminalToken: string;
  context: TerminalContext;
}

export interface OperatorSession {
  token: string;
  operator: { id: string; name: string; role: OperatorRole };
  expiresAt: string;
}

export interface EventTotals {
  topupsCents: number;
  topupsByMethod: Record<'cash' | 'card' | 'online', number>;
  salesCents: number;
  salesCount: number;
  voidsCents: number;
  refundsCents: number;
  wristbandFeesCents: number;
  depositsHeldCents: number;
  paidBalanceOutstandingCents: number;
  /** Deute de les polseres que han comprat en aquest esdeveniment (vendes sense connexió). */
  debtOutstandingCents: number;
  offlineSalesCount: number;
  /** Vendes sense connexió amb alguna incidència. */
  offlineIssuesCount: number;
  /** Vendes sense connexió que el servidor no ha pogut registrar (consten a l'auditoria). */
  offlineRejectedCount: number;
  promoBalanceOutstandingCents: number;
  activeWristbands: number;
  averageTicketCents: number;
  salesByVendor: { vendorId: string; vendorName: string; salesCents: number; count: number }[];
  topProducts: { productId: string; name: string; quantity: number; totalCents: number }[];
}

/** Torn de caixa d'una taquilla. */
export interface CashShift {
  id: string;
  eventId: string;
  terminalId: string;
  terminalName: string;
  operatorId: string;
  operatorName: string;
  openingFloatCents: number;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  /** Efectiu cobrat durant el torn (recàrregues, polseres i fiances; menys devolucions). */
  cashCents: number;
  /** Cobrat amb targeta: s'ha de quadrar amb el datàfon. */
  cardCents: number;
  operations: number;
  /** Fons + efectiu cobrat. Al tancar es desa el valor d'aquell moment. */
  expectedCashCents: number;
  declaredCashCents: number | null;
  /** Declarat − esperat (negatiu = falta efectiu). */
  differenceCents: number | null;
  note: string | null;
}

/** Totals d'un terminal en una jornada (de 6:00 a 6:00, hora de Catalunya). */
export interface CashDailyRow {
  day: string;
  terminalId: string | null;
  terminalName: string;
  pointOfSaleName: string | null;
  cashCents: number;
  cardCents: number;
  /** Vendes netes d'anul·lacions. */
  salesCents: number;
  operations: number;
}

export interface CashReport {
  shifts: CashShift[];
  daily: CashDailyRow[];
}

export interface ImportResult {
  created: number;
  updated: number;
  /** Files que ja existien i no han canviat (p. ex. polseres ja registrades). */
  unchanged: number;
}

/** Fila de la llista de polseres d'un esdeveniment. */
export interface WristbandSummary extends Balance {
  uid: string | null;
  movementsCount: number;
  lastMovementAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

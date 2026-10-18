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
  /** Saldo que es pot gastar ara (pagat + promocional). */
  availableCents: number;
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
  event: { id: string; name: string; status: EventStatus; wristbandPriceCents: number; wristbandDepositCents: number };
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
  promoBalanceOutstandingCents: number;
  activeWristbands: number;
  averageTicketCents: number;
  salesByVendor: { vendorId: string; vendorName: string; salesCents: number; count: number }[];
  topProducts: { productId: string; name: string; quantity: number; totalCents: number }[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

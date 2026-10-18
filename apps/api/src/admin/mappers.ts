/** Conversió de files de la base de dades al format de l'API. */
import type { EventSummary, Operator, Organization, PointOfSale, Product, Terminal, Vendor } from '@cashless/shared';
import type { EventRow, OperatorRow, ProductRow, TerminalRow } from '../db/schema';
import { organizations, pointsOfSale, vendors } from '../db/schema';

export function toOrganization(row: typeof organizations.$inferSelect): Organization {
  return { id: row.id, name: row.name, taxId: row.taxId, taxRegime: row.taxRegime, createdAt: row.createdAt.toISOString() };
}

export function toEvent(row: EventRow): EventSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    wristbandPriceCents: row.wristbandPriceCents,
    wristbandDepositCents: row.wristbandDepositCents,
    maxBalanceCents: row.maxBalanceCents,
  };
}

export function toVendor(row: typeof vendors.$inferSelect): Vendor {
  return { id: row.id, eventId: row.eventId, organizationId: row.organizationId, name: row.name, commissionBps: row.commissionBps };
}

export function toPointOfSale(row: typeof pointsOfSale.$inferSelect): PointOfSale {
  return { id: row.id, eventId: row.eventId, vendorId: row.vendorId, name: row.name, kind: row.kind, active: row.active };
}

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    eventId: row.eventId,
    vendorId: row.vendorId,
    name: row.name,
    priceCents: row.priceCents,
    vatRateBps: row.vatRateBps,
    category: row.category,
    color: row.color,
    sortOrder: row.sortOrder,
    destination: row.destination,
    active: row.active,
  };
}

export function toOperator(row: OperatorRow): Operator {
  return { id: row.id, eventId: row.eventId, name: row.name, role: row.role, active: row.active };
}

export function toTerminal(row: TerminalRow): Terminal {
  const pairingValid = row.pairingCode !== null && row.pairingExpiresAt !== null && row.pairingExpiresAt > new Date();
  return {
    id: row.id,
    eventId: row.eventId,
    pointOfSaleId: row.pointOfSaleId,
    name: row.name,
    deviceName: row.deviceName,
    active: row.active,
    pairedAt: row.pairedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    pairingCode: pairingValid ? row.pairingCode : null,
    pairingExpiresAt: pairingValid ? row.pairingExpiresAt!.toISOString() : null,
  };
}

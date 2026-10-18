/**
 * Lògica pura de càlcul d'una venda. No depèn de la base de dades,
 * així es pot provar fàcilment i reutilitzar al terminal en mode offline.
 */

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  vatRateBps: number;
}

export interface LineTotal extends PricedLine {
  totalCents: number;
}

export function priceLines(lines: PricedLine[]): { lines: LineTotal[]; totalCents: number } {
  const totals = lines.map((line) => ({ ...line, totalCents: line.unitPriceCents * line.quantity }));
  return { lines: totals, totalCents: totals.reduce((sum, l) => sum + l.totalCents, 0) };
}

export interface DebitSplit {
  promoCents: number;
  paidCents: number;
}

/**
 * Decideix d'on surt l'import d'una venda.
 * Primer es gasta el saldo promocional (no retornable) i després el pagat.
 * Retorna null si no hi ha prou saldo.
 */
export function splitDebit(totalCents: number, promoBalanceCents: number, paidBalanceCents: number): DebitSplit | null {
  if (totalCents < 0) throw new Error('El total no pot ser negatiu');
  if (promoBalanceCents + paidBalanceCents < totalCents) return null;
  const promoCents = Math.min(promoBalanceCents, totalCents);
  return { promoCents, paidCents: totalCents - promoCents };
}

/** Agrupa línies repetides del mateix producte (p. ex. tocar dues vegades el mateix botó). */
export function mergeLines<T extends { productId: string; quantity: number }>(lines: T[]): T[] {
  const byProduct = new Map<string, T>();
  for (const line of lines) {
    const existing = byProduct.get(line.productId);
    if (existing) existing.quantity += line.quantity;
    else byProduct.set(line.productId, { ...line });
  }
  return [...byProduct.values()];
}

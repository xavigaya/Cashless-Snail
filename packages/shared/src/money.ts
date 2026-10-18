/**
 * Tots els imports es treballen en cèntims d'euro (enters).
 * Mai no es fan servir decimals de coma flotant per a diners.
 */

const euroFormatter = new Intl.NumberFormat('ca-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
});

/** 1250 -> "12,50 €" */
export function formatEuros(cents: number): string {
  return euroFormatter.format(cents / 100);
}

/**
 * Converteix un text escrit per una persona a cèntims.
 * Accepta "12", "12,5", "12.50", "12,50 €". Retorna null si no és vàlid.
 */
export function parseEuros(input: string): number | null {
  const cleaned = input.replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Part d'IVA inclosa en un preu amb IVA.
 * vatRateBps: tipus en punts bàsics (1000 = 10 %, 2100 = 21 %).
 */
export function vatIncluded(grossCents: number, vatRateBps: number): number {
  return Math.round((grossCents * vatRateBps) / (10000 + vatRateBps));
}

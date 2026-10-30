/** Columnes dels fitxers CSV de cada secció, i com es llegeixen. */
import {
  matchOption,
  OPERATOR_ROLE_LABELS,
  parseEuros,
  parsePercentBps,
  parseYesNo,
  POS_KIND_LABELS,
  type Operator,
  type PointOfSale,
  type Product,
  type Terminal,
  type Vendor,
  type WristbandSummary,
} from '@cashless/shared';
import type { CsvSpec } from '../../csv-tools';

const yesNo = (v: boolean) => (v ? 'sí' : 'no');
// Sense separador de milers, perquè es pugui tornar a importar.
const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const percent = (bps: number) => (bps / 100).toLocaleString('ca-ES');
const required = (value: string | undefined, label: string) => (value && value.trim() ? null : `falta «${label}»`);

export function vendorsCsv(eventId: string, vendors: Vendor[]): CsvSpec<{ name: string; commissionBps: number }> {
  return {
    fileName: 'venedors',
    header: ['Nom', 'Comissió (%)'],
    exportRows: () => vendors.map((v) => [v.name, percent(v.commissionBps)]),
    importPath: `/events/${eventId}/import/vendors`,
    hint: 'Columnes: Nom i Comissió (%).',
    parse: (r) => {
      const missing = required(r.nom, 'Nom');
      if (missing) return missing;
      const bps = r.comissio ? parsePercentBps(r.comissio) : 0;
      if (bps === null || bps < 0 || bps > 10000) return `comissió no vàlida: «${r.comissio}»`;
      return { name: r.nom!, commissionBps: bps };
    },
  };
}

export function pointsOfSaleCsv(eventId: string, items: PointOfSale[], vendors: Vendor[]) {
  const vendorName = (id: string | null) => vendors.find((v) => v.id === id)?.name ?? '';
  return {
    fileName: 'punts-de-venda',
    header: ['Nom', 'Tipus', 'Venedor', 'Actiu'],
    exportRows: () => items.map((p) => [p.name, POS_KIND_LABELS[p.kind], vendorName(p.vendorId), yesNo(p.active)]),
    importPath: `/events/${eventId}/import/points-of-sale`,
    hint: 'Tipus: Barra, Cuina o Taquilla. Les barres i cuines necessiten el nom d’un venedor existent.',
    parse: (r: Record<string, string>) => {
      const missing = required(r.nom, 'Nom') ?? required(r.tipus, 'Tipus');
      if (missing) return missing;
      const kind = matchOption(r.tipus!, POS_KIND_LABELS);
      if (!kind) return `tipus desconegut: «${r.tipus}» (Barra, Cuina o Taquilla)`;
      const active = parseYesNo(r.actiu, true);
      if (active === null) return `«Actiu» ha de ser sí o no`;
      return { name: r.nom!, kind, vendorName: r.venedor || undefined, active };
    },
  } satisfies CsvSpec<unknown>;
}

export function productsCsv(eventId: string, items: Product[], vendors: Vendor[]) {
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name ?? '';
  return {
    fileName: 'productes',
    header: ['Venedor', 'Nom', 'Preu (€)', 'IVA (%)', 'Categoria', 'Color', 'Destinació', 'Ordre', 'Actiu'],
    exportRows: () =>
      items.map((p) => [
        vendorName(p.vendorId),
        p.name,
        euros(p.priceCents),
        percent(p.vatRateBps),
        p.category,
        p.color,
        p.destination === 'kitchen' ? 'Cuina' : 'Barra',
        p.sortOrder,
        yesNo(p.active),
      ]),
    importPath: `/events/${eventId}/import/products`,
    hint: 'El venedor ha d’existir. Preu en euros (3,50). Destinació: Barra o Cuina. Un producte amb el mateix nom i venedor s’actualitza.',
    parse: (r: Record<string, string>) => {
      const missing = required(r.venedor, 'Venedor') ?? required(r.nom, 'Nom') ?? required(r.preu, 'Preu');
      if (missing) return missing;
      const price = parseEuros(r.preu!);
      if (price === null || price <= 0) return `preu no vàlid: «${r.preu}»`;
      const vat = r.iva ? parsePercentBps(r.iva) : 1000;
      if (vat === null || vat < 0 || vat > 10000) return `IVA no vàlid: «${r.iva}»`;
      const destination = r.destinacio ? matchOption(r.destinacio, { bar: 'Barra', kitchen: 'Cuina' }) : 'bar';
      if (!destination) return `destinació desconeguda: «${r.destinacio}» (Barra o Cuina)`;
      const color = r.color || '#3B6FB6';
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return `color no vàlid: «${r.color}» (format #RRGGBB)`;
      const sortOrder = r.ordre ? Number(r.ordre) : 0;
      if (!Number.isInteger(sortOrder)) return `ordre no vàlid: «${r.ordre}»`;
      const active = parseYesNo(r.actiu, true);
      if (active === null) return `«Actiu» ha de ser sí o no`;
      return {
        vendorName: r.venedor!,
        name: r.nom!,
        priceCents: price,
        vatRateBps: vat,
        category: r.categoria || 'General',
        color,
        destination,
        sortOrder,
        active,
      };
    },
  } satisfies CsvSpec<unknown>;
}

export function operatorsCsv(eventId: string, items: Operator[]) {
  return {
    fileName: 'operadors',
    header: ['Nom', 'Rol', 'PIN', 'Actiu'],
    // Els PIN no es poden exportar (només se'n guarda el hash).
    exportRows: () => items.map((o) => [o.name, OPERATOR_ROLE_LABELS[o.role], '', yesNo(o.active)]),
    importPath: `/events/${eventId}/import/operators`,
    hint: 'Rol: Cap de barra, Caixer, Cambrer o Taquiller. El PIN (4 a 6 xifres) és obligatori per als operadors nous; si es deixa buit, el dels existents no canvia.',
    parse: (r: Record<string, string>) => {
      const missing = required(r.nom, 'Nom') ?? required(r.rol, 'Rol');
      if (missing) return missing;
      const role = matchOption(r.rol!, OPERATOR_ROLE_LABELS);
      if (!role) return `rol desconegut: «${r.rol}»`;
      const pin = r.pin?.trim() || undefined;
      if (pin && !/^\d{4,6}$/.test(pin)) return `el PIN de ${r.nom} ha de tenir entre 4 i 6 xifres`;
      const active = parseYesNo(r.actiu, true);
      if (active === null) return `«Actiu» ha de ser sí o no`;
      return { name: r.nom!, role, pin, active };
    },
  } satisfies CsvSpec<unknown>;
}

export function terminalsCsv(eventId: string, items: Terminal[], pos: PointOfSale[]) {
  const posName = (id: string) => pos.find((p) => p.id === id)?.name ?? '';
  return {
    fileName: 'terminals',
    header: ['Nom', 'Punt de venda', 'Actiu', 'Dispositiu', 'Última connexió'],
    exportRows: () => items.map((t) => [t.name, posName(t.pointOfSaleId), yesNo(t.active), t.deviceName ?? '', t.lastSeenAt ?? '']),
    importPath: `/events/${eventId}/import/terminals`,
    hint: 'El punt de venda ha d’existir. Els terminals nous reben un codi de vinculació (vàlid 30 minuts; se’n pot demanar un altre).',
    parse: (r: Record<string, string>) => {
      const missing = required(r.nom, 'Nom') ?? required(r.punt_de_venda, 'Punt de venda');
      if (missing) return missing;
      const active = parseYesNo(r.actiu, true);
      if (active === null) return `«Actiu» ha de ser sí o no`;
      return { name: r.nom!, pointOfSaleName: r.punt_de_venda!, active };
    },
  } satisfies CsvSpec<unknown>;
}

const STATUS_LABELS = { active: 'Activa', blocked: 'Bloquejada', lost: 'Perduda' } as const;

export function wristbandsCsv(eventId: string, load: () => Promise<WristbandSummary[]>) {
  return {
    fileName: 'polseres',
    header: ['Codi', 'UID', 'Estat', 'Activada', 'Saldo pagat (€)', 'Saldo promocional (€)', 'Fiança (€)', 'Deute (€)', 'Moviments', 'Últim moviment'],
    exportRows: async () =>
      (await load()).map((w) => [
        w.code,
        w.uid ?? '',
        STATUS_LABELS[w.status],
        yesNo(w.activatedInEvent),
        euros(Math.max(0, w.paidCents)),
        euros(w.promoCents),
        euros(w.depositCents),
        euros(w.debtCents),
        w.movementsCount,
        w.lastMovementAt,
      ]),
    importPath: `/events/${eventId}/import/wristbands`,
    hint: 'Registre previ de polseres (p. ex. la llista d’UID del proveïdor): columnes Codi i/o UID. Es creen sense saldo; les ja registrades no canvien. La resta de columnes s’ignoren.',
    parse: (r: Record<string, string>) => {
      const uid = r.uid?.trim() || undefined;
      const code = r.codi?.trim() || undefined;
      if (!uid && !code) return 'cal el Codi o l’UID';
      return { uid, code };
    },
  } satisfies CsvSpec<unknown>;
}

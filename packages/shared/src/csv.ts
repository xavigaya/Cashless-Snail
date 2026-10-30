/**
 * Fitxers CSV per importar i exportar dades des del backoffice.
 * Per defecte es fa servir el punt i coma, que és el que obre bé l'Excel en català.
 */

/** Llegeix un CSV (separat per ";", "," o tabulador, detectat a la capçalera). Admet camps entre cometes. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ';');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Converteix files en objectes segons la capçalera (claus normalitzades: minúscules, sense accents ni espais). */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map(normalizeKey);
  return rows.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}

/** Genera un CSV amb punt i coma i marca BOM (perquè l'Excel reconegui els accents). */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

/** "Punt de venda" → "punt_de_venda"; "Comissió (%)" → "comissio" */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Tria una opció pel seu codi o la seva etiqueta, sense tenir en compte majúscules ni accents. */
export function matchOption<T extends string>(value: string, labels: Record<T, string>): T | null {
  const wanted = normalizeKey(value);
  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    if (normalizeKey(code) === wanted || normalizeKey(label) === wanted) return code;
  }
  return null;
}

/** "sí", "si", "1", "true", "x" → true; "no", "0", "false" → false; buit → valor per defecte. */
export function parseYesNo(value: string | undefined, fallback: boolean): boolean | null {
  const v = normalizeKey(value ?? '');
  if (v === '') return fallback;
  if (['si', 's', '1', 'true', 'x', 'yes', 'actiu', 'activa'].includes(v)) return true;
  if (['no', 'n', '0', 'false', 'inactiu', 'inactiva'].includes(v)) return false;
  return null;
}

/** "10", "10,5", "10.5 %" → punts bàsics (1000, 1050). */
export function parsePercentBps(value: string): number | null {
  const n = Number(value.replace('%', '').replace(',', '.').trim());
  return value.trim() !== '' && Number.isFinite(n) ? Math.round(n * 100) : null;
}

function count(text: string, ch: string): number {
  let n = 0;
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ch) n++;
  }
  return n;
}

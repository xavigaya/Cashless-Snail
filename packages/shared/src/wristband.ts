/**
 * Identificació de polseres.
 * - Per NFC es llegeix l'UID del xip (hexadecimal).
 * - Per QR es llegeix el codi imprès, amb el prefix "CS:".
 */

const QR_PREFIX = 'CS:';
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32, sense I, L, O, U
const CODE_LENGTH = 10;

/** "04:a2:3b:..." o "04a23b..." -> "04A23B..." */
export function normalizeUid(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

export function isValidUid(uid: string): boolean {
  return /^[0-9A-F]{8,20}$/.test(uid);
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** Genera un codi imprès nou a partir de bytes aleatoris (crypto del servidor o del dispositiu). */
export function codeFromRandomBytes(bytes: Uint8Array): string {
  if (bytes.length < CODE_LENGTH) throw new Error(`Calen ${CODE_LENGTH} bytes aleatoris`);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return code;
}

export function wristbandQrPayload(code: string): string {
  return `${QR_PREFIX}${code}`;
}

/** Interpreta el text d'un QR escanejat. Accepta "CS:XXXX" o el codi sol. */
export function parseWristbandQr(text: string): string | null {
  const trimmed = text.trim();
  const raw = trimmed.toUpperCase().startsWith(QR_PREFIX) ? trimmed.slice(QR_PREFIX.length) : trimmed;
  const code = normalizeCode(raw);
  return isValidCode(code) ? code : null;
}

/** Format visual per imprimir: "ABCDE-FGHJK" */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Contingut del QR que mostra el backoffice per vincular un terminal. */
export interface PairingQr {
  type: 'cashless-pairing';
  apiUrl: string;
  code: string;
}

export function pairingQrPayload(apiUrl: string, code: string): string {
  const payload: PairingQr = { type: 'cashless-pairing', apiUrl, code };
  return JSON.stringify(payload);
}

export function parsePairingQr(text: string): PairingQr | null {
  try {
    const value = JSON.parse(text) as Partial<PairingQr>;
    if (value.type === 'cashless-pairing' && typeof value.apiUrl === 'string' && typeof value.code === 'string') {
      return { type: value.type, apiUrl: value.apiUrl, code: value.code };
    }
  } catch {
    // no és un QR de vinculació
  }
  return null;
}

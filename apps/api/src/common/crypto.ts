/** Utilitats criptogràfiques basades només en node:crypto. */
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { codeFromRandomBytes } from '@cashless/shared';

const SCRYPT_N = 16384;
const SCRYPT_KEYLEN = 32;

function scryptAsync(secret: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, SCRYPT_KEYLEN, { N: n, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hash per a contrasenyes i PIN. Format: scrypt$N$salt$hash (base64url). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, SCRYPT_N);
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algo, n, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(secret, Buffer.from(salt, 'base64url'), Number(n));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Token aleatori llarg (per als terminals). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Els tokens dels terminals ja tenen prou entropia: n'hi ha prou amb un SHA-256. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Codi curt per vincular un terminal (8 caràcters, sense ambigus). */
export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}

export function generateWristbandCode(): string {
  return codeFromRandomBytes(randomBytes(10));
}

/** JSON amb les claus ordenades, per calcular hashos estables d'una petició. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** UUID determinista derivat d'un altre (per a moviments secundaris d'una mateixa operació). */
export function deriveUuid(base: string, suffix: string): string {
  const h = createHash('sha256').update(`${base}:${suffix}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

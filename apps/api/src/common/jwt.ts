/**
 * Tokens de sessió JWT (HS256) amb node:crypto, sense dependències externes.
 * Funciona a Node i a Deno.
 */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function signature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Signa un token que caduca al cap de `expiresInSeconds`. */
export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })).toString('base64url');
  const data = `${HEADER}.${body}`;
  return `${data}.${signature(data, secret)}`;
}

/** Verifica la signatura i la caducitat. Retorna el contingut, o null si no és vàlid. */
export function verifyJwt<T extends object>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  if (header !== HEADER) return null;
  const expected = Buffer.from(signature(`${header}.${body}`, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

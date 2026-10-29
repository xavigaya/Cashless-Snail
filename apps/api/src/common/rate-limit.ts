/**
 * Límit d'intents per IP a les rutes d'entrada (contrasenya, PIN, vinculació).
 *
 * És una primera barrera: les proteccions definitives són a la base de dades
 * (bloqueig del compte d'administrador i del PIN de l'operador després de massa errors),
 * que funcionen encara que algú falsegi la seva IP.
 *
 * Comptador en memòria: al servidor local és exacte; a Supabase cada instància
 * de la funció té el seu.
 */
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { ApiError } from '@cashless/shared';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Final de ruta protegit, p. ex. "/auth/login". */
  path: string;
  /** Peticions màximes per IP i finestra. */
  max: number;
}

export interface RateLimitOptions {
  rules: RateLimitRule[];
  windowMs: number;
  clientIp: (c: Context) => string;
  /** Entrades màximes en memòria; en superar-les s'eliminen les més antigues. */
  maxBuckets?: number;
}

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const maxBuckets = options.maxBuckets ?? 10_000;

  function prune(now: number): void {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    // Si continua ple (moltes IP diferents alhora), es descarten les entrades més antigues.
    for (const key of buckets.keys()) {
      if (buckets.size <= maxBuckets * 0.9) break;
      buckets.delete(key);
    }
  }

  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    const rule = c.req.method === 'POST' ? options.rules.find((r) => path.endsWith(r.path)) : undefined;
    if (!rule) {
      await next();
      return;
    }
    const now = Date.now();
    if (buckets.size >= maxBuckets) prune(now);
    const key = `${options.clientIp(c)}|${rule.path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.delete(key);
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > rule.max) {
      const body: ApiError = {
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        message: 'Massa intents. Espera un minut i torna-ho a provar.',
      };
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return c.json(body, 429);
    }
    await next();
  });
}

/**
 * IP del client darrere d'un proxy de confiança (Render): l'última adreça de X-Forwarded-For,
 * que és la que afegeix el proxy i el client no pot falsejar.
 */
export function proxiedIp(c: Context): string | undefined {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',').at(-1)?.trim() || undefined;
}

/**
 * IP del client a Supabase Edge Functions: la capçalera que posa la xarxa de Supabase
 * (cf-connecting-ip / x-real-ip) o, si no n'hi ha, la primera de X-Forwarded-For.
 * Pot no ser fiable, però aquest límit és només la primera barrera (vegeu més amunt).
 */
export function edgeClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip')?.trim() ||
    c.req.header('x-real-ip')?.trim() ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'desconeguda'
  );
}

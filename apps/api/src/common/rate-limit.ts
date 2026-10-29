/**
 * Límit d'intents per IP a les rutes d'entrada (contrasenya, PIN, vinculació),
 * per dificultar que algú provi contrasenyes o codis a la força des d'internet.
 * Comptador en memòria: al servidor local és exacte; a Supabase cada instància
 * de la funció té el seu (el bloqueig de PIN a la base de dades continua actiu).
 */
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { ApiError } from '@cashless/shared';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Finals de ruta protegits, p. ex. "/auth/login". */
  paths: string[];
  max: number;
  windowMs: number;
  clientIp: (c: Context) => string;
}

const MAX_BUCKETS = 10_000;

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return createMiddleware(async (c, next) => {
    const path = c.req.path;
    if (c.req.method !== 'POST' || !options.paths.some((p) => path.endsWith(p))) {
      await next();
      return;
    }
    const now = Date.now();
    // Neteja ocasional sense temporitzadors (a les Edge Functions no n'hi ha de persistents).
    if (buckets.size > MAX_BUCKETS) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    }
    const key = `${options.clientIp(c)}|${path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
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

/** IP del client a partir de la capçalera del proxy (Supabase, Render) o un valor per defecte. */
export function forwardedIp(c: Context, fallback = 'local'): string {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || fallback;
}

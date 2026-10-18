/**
 * Límit d'intents per IP a les rutes d'entrada (contrasenya, PIN, vinculació),
 * per dificultar que algú provi contrasenyes o codis a la força des d'internet.
 * Comptador en memòria: suficient per a un sol servidor.
 */
import type { NextFunction, Request, Response } from 'express';
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
}

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, options.windowMs);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST' || !options.paths.some((p) => req.path.endsWith(p))) {
      next();
      return;
    }
    const key = `${req.ip ?? 'desconeguda'}|${req.path}`;
    const now = Date.now();
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
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json(body);
      return;
    }
    next();
  };
}

/**
 * Aplicació HTTP de l'API. És la mateixa per al servidor local (Node)
 * i per a l'Edge Function de Supabase (Deno): només canvia l'entrada.
 */
import { Hono, type Context, type Env } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@cashless/shared';
import type { AppConfig } from '../config';
import { toApiError } from '../common/errors';
import { rateLimit } from '../common/rate-limit';
import type { Db } from '../db/db';
import { LedgerService } from '../ledger/ledger.service';
import { AdminAccess } from '../admin/admin-access';
import { CashService } from '../cash/cash.service';
import { TERMINAL_TOKEN_HEADER } from './auth-middleware';
import type { AppDeps, AppEnv } from './context';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { eventRoutes } from './routes/events';
import { organizationRoutes } from './routes/organizations';
import { staffRoutes } from './routes/staff';
import { tpvRoutes } from './routes/tpv';

const MAX_BODY_BYTES = 100 * 1024;
// Com abans (Express): /events i /events/ són la mateixa ruta.
const ROUTER_OPTIONS = { strict: false } as const;

export interface CreateAppOptions {
  db: Db;
  config: AppConfig;
  clientIp: (c: Context) => string;
}

/** Construeix només les rutes de l'API, sense prefix. */
export function createApi(options: CreateAppOptions): Hono<AppEnv> {
  const deps: AppDeps = {
    db: options.db,
    config: options.config,
    ledger: new LedgerService(options.db),
    access: new AdminAccess(options.db),
    cash: new CashService(options.db),
    clientIp: options.clientIp,
  };
  const api = new Hono<AppEnv>(ROUTER_OPTIONS);

  api.use(
    '*',
    cors({
      origin: options.config.corsOrigins,
      allowHeaders: ['Content-Type', 'Authorization', TERMINAL_TOKEN_HEADER],
      allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  // Molts terminals poden compartir una mateixa IP (la wifi de l'esdeveniment): el PIN i la
  // vinculació tenen marge; el PIN es bloqueja igualment per operador després de 5 errors.
  api.use(
    '*',
    rateLimit({
      rules: [
        { path: '/auth/login', max: 10 },
        { path: '/tpv/login', max: 60 },
        { path: '/tpv/pair', max: 30 },
      ],
      windowMs: 60_000,
      clientIp: deps.clientIp,
    }),
  );
  // Cap petició legítima de l'API passa de pocs kB.
  api.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => {
        const body: ApiError = { statusCode: 413, code: 'VALIDATION_ERROR', message: 'La petició és massa gran' };
        return c.json(body, 413);
      },
    }),
  );

  /** Comprovació de salut per a monitoratge. */
  api.get('/health', async (c) => {
    await deps.db.execute(sql`SELECT 1`);
    return c.json({ status: 'ok' as const, time: new Date().toISOString() });
  });

  /** Dades públiques que necessita el backoffice (p. ex. per generar el QR de vinculació). */
  api.get('/meta', (c) => c.json({ publicApiUrl: options.config.publicApiUrl }));

  api.route('/', authRoutes(deps));
  api.route('/', organizationRoutes(deps));
  api.route('/', eventRoutes(deps));
  api.route('/', catalogRoutes(deps));
  api.route('/', staffRoutes(deps));
  api.route('/', tpvRoutes(deps));

  attachErrorHandlers(api);
  return api;
}

/** API muntada sota el prefix configurat (p. ex. "/api"), o a l'arrel si no n'hi ha. */
export function createApp(options: CreateAppOptions): Hono {
  const api = createApi(options);
  const prefix = options.config.apiPrefix;
  if (!prefix) return api as unknown as Hono;
  const app = new Hono(ROUTER_OPTIONS);
  app.route(`/${prefix}`, api);
  attachErrorHandlers(app);
  return app;
}

/** Errors i rutes inexistents amb el format JSON comú (ApiError). */
function attachErrorHandlers<E extends Env>(app: Hono<E>): void {
  app.notFound((c) => {
    const body: ApiError = { statusCode: 404, code: 'NOT_FOUND', message: `Cannot ${c.req.method} ${c.req.path}` };
    return c.json(body, 404);
  });
  app.onError((error, c) => {
    const body = toApiError(error);
    if (body.statusCode >= 500) console.error(error);
    return c.json(body, body.statusCode as ContentfulStatusCode);
  });
}

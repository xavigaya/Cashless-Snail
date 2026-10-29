/**
 * Entrada del servidor per a Node (versió local i Render).
 * La mateixa API es desplega a Supabase amb src/edge.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Server } from 'node:http';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { forwardedIp } from './common/rate-limit';
import { loadEnvFile, readConfig, type AppConfig } from './config';
import { createDb, createSql, type SqlClient } from './db/db';
import { createApp } from './http/app';

export interface RunningServer {
  server: ServerType;
  url: string;
  close: () => Promise<void>;
}

/** IP del client: la del proxy si n'hi ha (Render), si no la de la connexió. */
function nodeClientIp(c: Context): string {
  const viaProxy = forwardedIp(c, '');
  if (viaProxy) return viaProxy;
  try {
    return getConnInfo(c).remote.address ?? 'desconeguda';
  } catch {
    return 'desconeguda';
  }
}

/**
 * Serveix el backoffice compilat des del mateix servidor (un sol servei).
 * Qualsevol ruta GET que no sigui de l'API ni un fitxer retorna index.html (aplicació d'una sola pàgina).
 */
function serveBackoffice(app: Hono, dir: string, apiPrefix?: string): void {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) throw new Error(`No es troba el backoffice compilat a ${dir}`);
  if (!apiPrefix) throw new Error('Per servir el backoffice cal definir API_PREFIX (p. ex. "api")');
  const index = readFileSync(indexPath, 'utf8');
  const root = relative(process.cwd(), dir) || '.';

  app.get('*', async (c, next) => {
    const path = c.req.path;
    if (path === `/${apiPrefix}` || path.startsWith(`/${apiPrefix}/`)) return next();
    // index.html sempre fresc (apunta als fitxers de la versió actual); la resta, a la memòria cau.
    if (path === '/' || path.endsWith('/index.html')) return c.html(index, 200, { 'Cache-Control': 'no-cache' });
    const file = await serveStatic({ root })(c, async () => undefined);
    if (file) {
      file.headers.set('Cache-Control', 'public, max-age=3600');
      return file;
    }
    return c.html(index, 200, { 'Cache-Control': 'no-cache' });
  });
}

export function startServer(config: AppConfig, sql: SqlClient = createSql(config.databaseUrl), port = config.port): Promise<RunningServer> {
  const app = createApp({ db: createDb(sql), config, clientIp: nodeClientIp });
  if (config.backofficeDir) serveBackoffice(app, config.backofficeDir, config.apiPrefix);

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
      resolve({
        server,
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((done) => {
            (server as Server).close(() => done());
            (server as Server).closeAllConnections?.();
          }).then(() => sql.end({ timeout: 5 })),
      });
    });
  });
}

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const config = readConfig();
  const running = await startServer(config);
  console.log(`API escoltant al port ${config.port} · adreça pública: ${config.publicApiUrl}`);
  const stop = () => void running.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  void bootstrap();
}

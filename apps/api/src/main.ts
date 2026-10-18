import 'reflect-metadata';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors';
import { rateLimit } from './common/rate-limit';
import { loadEnvFile, readConfig, type AppConfig } from './config';
import { TERMINAL_TOKEN_HEADER } from './auth/guards';

/** Configura l'aplicació. Es fa servir tant per arrencar el servidor com a les proves. */
export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  // Darrere del proxy de la plataforma: així req.ip és la IP real del client.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  if (config.apiPrefix) app.setGlobalPrefix(config.apiPrefix);

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: config.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', TERMINAL_TOKEN_HEADER],
  });
  app.use(rateLimit({ paths: ['/auth/login', '/tpv/pair', '/tpv/login'], max: 10, windowMs: 60_000 }));

  if (config.backofficeDir) serveBackoffice(app, config.backofficeDir, config.apiPrefix);

  app.enableShutdownHooks();
  return app;
}

/**
 * Serveix el backoffice compilat des del mateix servidor (un sol servei al núvol).
 * Qualsevol ruta que no sigui de l'API ni un fitxer retorna index.html (aplicació d'una sola pàgina).
 */
function serveBackoffice(app: NestExpressApplication, dir: string, apiPrefix?: string): void {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) throw new Error(`No es troba el backoffice compilat a ${dir}`);
  if (!apiPrefix) throw new Error('Per servir el backoffice cal definir API_PREFIX (p. ex. "api")');

  app.useStaticAssets(dir, { index: false, maxAge: '1h' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path === `/${apiPrefix}` || req.path.startsWith(`/${apiPrefix}/`);
    if (req.method !== 'GET' || isApi) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const config = readConfig();
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config)), config);
  await app.listen(config.port, '0.0.0.0');
  console.log(`API escoltant al port ${config.port} · adreça pública: ${config.publicApiUrl}`);
}

if (require.main === module) {
  void bootstrap();
}

import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/errors';
import { loadEnvFile, readConfig, type AppConfig } from './config';
import { TERMINAL_TOKEN_HEADER } from './auth/guards';

/** Configura l'aplicació. Es fa servir tant per arrencar el servidor com a les proves. */
export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: config.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', TERMINAL_TOKEN_HEADER],
  });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  loadEnvFile();
  const config = readConfig();
  const app = configureApp(await NestFactory.create(AppModule.forRoot(config)), config);
  await app.listen(config.port, '0.0.0.0');
  console.log(`API escoltant a http://localhost:${config.port}`);
}

if (require.main === module) {
  void bootstrap();
}

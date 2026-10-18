/** Configuració llegida de les variables d'entorn (o del fitxer .env). */
import { resolve } from 'node:path';

export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // Sense fitxer .env: es fan servir les variables d'entorn del sistema.
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable d'entorn ${name}`);
  return value;
}

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  port: number;
  corsOrigins: string[];
  publicApiUrl: string;
  /** Prefix de totes les rutes de l'API (p. ex. "api"). Buit en desenvolupament. */
  apiPrefix?: string;
  /** Carpeta amb el backoffice compilat. Si s'indica, el mateix servidor el serveix. */
  backofficeDir?: string;
}

export function readConfig(): AppConfig {
  const jwtSecret = required('JWT_SECRET');
  if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET ha de tenir almenys 32 caràcters en producció');
  }
  const port = Number(process.env.PORT ?? 3000);
  const apiPrefix = (process.env.API_PREFIX ?? '').replace(/^\/+|\/+$/g, '');
  const suffix = apiPrefix ? `/${apiPrefix}` : '';
  // Render (i altres plataformes) publiquen l'adreça externa del servei en aquesta variable.
  const external = process.env.RENDER_EXTERNAL_URL;
  return {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    port,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicApiUrl: process.env.PUBLIC_API_URL ?? (external ? `${external}${suffix}` : `http://localhost:${port}${suffix}`),
    apiPrefix: apiPrefix || undefined,
    backofficeDir: process.env.BACKOFFICE_DIST ? resolve(process.env.BACKOFFICE_DIST) : undefined,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

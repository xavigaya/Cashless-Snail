/** Configuració llegida de les variables d'entorn (o del fitxer .env). */

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
}

export function readConfig(): AppConfig {
  const jwtSecret = required('JWT_SECRET');
  if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET ha de tenir almenys 32 caràcters en producció');
  }
  const port = Number(process.env.PORT ?? 3000);
  return {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret,
    port,
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${port}`,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

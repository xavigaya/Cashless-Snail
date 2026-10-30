/**
 * Connexió a PostgreSQL amb postgres-js + Drizzle.
 * Funciona igual a Node (servidor local) i a Deno (Edge Function de Supabase).
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** Transacció de Drizzle: té la mateixa interfície que Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Qualsevol objecte amb què es poden fer consultes: la connexió o una transacció. */
export type Queryable = Db | Tx;
export type SqlClient = postgres.Sql;

export interface SqlOptions {
  /** Connexions màximes. A Supabase, poques: cada instància de la funció obre les seves. */
  max?: number;
}

export function createSql(databaseUrl: string, options: SqlOptions = {}): SqlClient {
  return postgres(databaseUrl, {
    max: options.max ?? 10,
    // El pooler de Supabase en mode transacció no admet sentències preparades.
    prepare: false,
    idle_timeout: 20,
    // Renova les connexions periòdicament (a Supabase la funció es pot congelar entre peticions).
    max_lifetime: 5 * 60,
    onnotice: () => undefined,
    connection: { application_name: 'cashless-snail' },
  });
}

export function createDb(sql: SqlClient): Db {
  return drizzle(sql, { schema });
}

/** Codi d'error de PostgreSQL per a violació d'unicitat (també dins d'errors embolcallats per Drizzle). */
/** L'error de PostgreSQL és perquè altres files depenen d'aquesta (clau forana)? */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === '23503') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (e.code === '23505') {
      const name = e.constraint_name ?? e.constraint;
      return constraint === undefined || name === constraint;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Aplica les migracions SQL de /migrations en ordre.
 * Cada fitxer s'aplica una sola vegada i dins d'una transacció.
 * Ús: pnpm db:migrate   (necessita DATABASE_URL; a Supabase, la connexió "Session pooler")
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvFile } from '../config';
import { createSql, type SqlClient } from './db';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const LOCK_ID = 727274; // bloqueig per evitar dues migracions alhora

export async function runMigrations(sql: SqlClient, log: (msg: string) => void = console.log): Promise<string[]> {
  // Una connexió reservada: el bloqueig de sessió i les transaccions han d'anar per la mateixa.
  const conn = await sql.reserve();
  const applied: string[] = [];
  try {
    await conn`SELECT pg_advisory_lock(${LOCK_ID})`;
    await conn`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`;
    const done = new Set((await conn<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await conn`BEGIN`;
      try {
        await conn.unsafe(text);
        await conn`INSERT INTO schema_migrations (name) VALUES (${file})`;
        await conn`COMMIT`;
      } catch (error) {
        await conn`ROLLBACK`;
        throw new Error(`La migració ${file} ha fallat: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`Aplicada ${file}`);
    }
  } finally {
    await conn`SELECT pg_advisory_unlock(${LOCK_ID})`.catch(() => undefined);
    conn.release();
  }
  return applied;
}

if (require.main === module) {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const sql = createSql(url, { max: 1 });
  runMigrations(sql)
    .then((applied) => console.log(applied.length ? `${applied.length} migracions aplicades` : 'La base de dades ja està al dia'))
    .catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => sql.end({ timeout: 5 }));
}

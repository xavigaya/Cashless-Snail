/**
 * Aplica les migracions SQL de /migrations en ordre.
 * Cada fitxer s'aplica una sola vegada i dins d'una transacció.
 * Ús: pnpm db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { loadEnvFile } from '../config';
import { createPool } from './db';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const LOCK_ID = 727274; // bloqueig per evitar dues migracions alhora

export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`La migració ${file} ha fallat: ${(error as Error).message}`);
      }
      applied.push(file);
      log(`Aplicada ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
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
  const pool = createPool(url);
  runMigrations(pool)
    .then((applied) => console.log(applied.length ? `${applied.length} migracions aplicades` : 'La base de dades ja està al dia'))
    .catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

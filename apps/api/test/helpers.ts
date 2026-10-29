/**
 * Utilitats per a les proves de punta a punta.
 * Necessiten una base de dades PostgreSQL buida: TEST_DATABASE_URL.
 * ATENCIÓ: les proves esborren totes les dades d'aquesta base de dades.
 */
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startServer, type RunningServer } from '../src/main';
import { runMigrations } from '../src/db/migrate';
import { createSql, type SqlClient } from '../src/db/db';
import type { AppConfig } from '../src/config';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/cashless_test';

/** Connexió directa a la base de dades de proves (per preparar dades o fer comprovacions). */
export function testSql(): SqlClient {
  return createSql(TEST_DATABASE_URL, { max: 2 });
}

export async function resetDatabase(): Promise<void> {
  const sql = testSql();
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(sql, () => undefined);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Arrenca el servidor real (el mateix que en producció) en un port lliure.
 * Si TEST_API_URL està definida, fa les proves contra aquella API ja en marxa
 * (per exemple, l'Edge Function executada amb Deno), que ha de fer servir la mateixa base de dades.
 */
export async function createTestServer(): Promise<RunningServer> {
  const external = process.env.TEST_API_URL;
  if (external) return { server: undefined as never, url: external.replace(/\/+$/, ''), close: async () => undefined };
  const config: AppConfig = {
    databaseUrl: TEST_DATABASE_URL,
    jwtSecret: 'clau-de-proves-prou-llarga-per-signar-tokens',
    port: 0,
    corsOrigins: [],
    publicApiUrl: 'http://localhost:3000',
  };
  return startServer(config, createSql(TEST_DATABASE_URL, { max: 20 }), 0);
}

/** Crea l'administrador de plataforma directament a la base de dades. */
export async function createPlatformAdmin(email: string, password: string): Promise<void> {
  const { hashSecret } = await import('../src/common/crypto');
  const sql = testSql();
  try {
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO admin_users (email, name, password_hash) VALUES (${email}, 'Admin', ${await hashSecret(password)}) RETURNING id`;
    await sql`INSERT INTO role_assignments (user_id, role) VALUES (${user!.id}, 'platform_admin')`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export const newId = () => randomUUID();

/** Client HTTP amb les capçaleres d'autenticació preparades. */
export class Client {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Record<string, string> = {},
  ) {}

  with(headers: Record<string, string>): Client {
    return new Client(this.baseUrl, { ...this.headers, ...headers });
  }

  get(path: string) {
    return request(this.baseUrl).get(path).set(this.headers);
  }

  post(path: string, body: object = {}) {
    return request(this.baseUrl).post(path).set(this.headers).send(body);
  }

  patch(path: string, body: object = {}) {
    return request(this.baseUrl).patch(path).set(this.headers).send(body);
  }
}

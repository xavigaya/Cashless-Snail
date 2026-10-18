/**
 * Utilitats per a les proves de punta a punta.
 * Necessiten una base de dades PostgreSQL buida: TEST_DATABASE_URL.
 * ATENCIÓ: les proves esborren totes les dades d'aquesta base de dades.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { runMigrations } from '../src/db/migrate';
import type { AppConfig } from '../src/config';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/cashless_test';

export async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(pool, () => undefined);
  } finally {
    await pool.end();
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const config: AppConfig = {
    databaseUrl: TEST_DATABASE_URL,
    jwtSecret: 'clau-de-proves-prou-llarga-per-signar-tokens',
    port: 0,
    corsOrigins: [],
    publicApiUrl: 'http://localhost:3000',
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }), config);
  // Escoltar en un port real evita que supertest obri un servidor nou per a cada petició.
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Crea l'administrador de plataforma directament a la base de dades. */
export async function createPlatformAdmin(email: string, password: string): Promise<void> {
  const { hashSecret } = await import('../src/common/crypto');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO admin_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, 'Admin', await hashSecret(password)],
    );
    await pool.query("INSERT INTO role_assignments (user_id, role) VALUES ($1, 'platform_admin')", [rows[0]!.id]);
  } finally {
    await pool.end();
  }
}

export const newId = () => randomUUID();

/** Client HTTP amb les capçaleres d'autenticació preparades. */
export class Client {
  constructor(
    private readonly app: INestApplication,
    private readonly headers: Record<string, string> = {},
  ) {}

  with(headers: Record<string, string>): Client {
    return new Client(this.app, { ...this.headers, ...headers });
  }

  get(path: string) {
    return request(this.app.getHttpServer()).get(path).set(this.headers);
  }

  post(path: string, body: object = {}) {
    return request(this.app.getHttpServer()).post(path).set(this.headers).send(body);
  }

  patch(path: string, body: object = {}) {
    return request(this.app.getHttpServer()).patch(path).set(this.headers).send(body);
  }
}

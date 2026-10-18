import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** Transacció de Drizzle: té la mateixa interfície que Db. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Qualsevol objecte amb què es poden fer consultes: la connexió o una transacció. */
export type Queryable = Db | Tx;

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 20 });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

/** Codi d'error de PostgreSQL per a violació d'unicitat. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = (error as { cause?: unknown })?.cause ?? error;
  const pgError = e as { code?: string; constraint?: string };
  return pgError?.code === '23505' && (constraint === undefined || pgError.constraint === constraint);
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => createDb(pool),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

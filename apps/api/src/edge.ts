/**
 * Entrada de l'API per a Supabase Edge Functions (Deno).
 * Fa servir la mateixa aplicació que el servidor local (src/http/app.ts).
 *
 * Supabase envia a la funció "api" les peticions de
 *   https://<projecte>.supabase.co/functions/v1/api/...
 * amb el camí "/api/...", per això el prefix és "api".
 *
 * Variables d'entorn:
 *   SUPABASE_DB_URL, SUPABASE_URL  les posa Supabase automàticament
 *   CASHLESS_JWT_SECRET            clau per signar les sessions (secret de la funció)
 *   CORS_ORIGINS                   orígens permesos del backoffice, separats per comes
 *   DATABASE_URL                   (opcional) per fer servir una altra base de dades
 */
import type { AppConfig } from './config';
import { edgeClientIp } from './common/rate-limit';
import { createDb, createSql } from './db/db';
import { createApp } from './http/app';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta la variable d'entorn ${name}`);
  return value;
}

const env = (name: string) => Deno.env.get(name);
const supabaseUrl = env('SUPABASE_URL')?.replace(/\/+$/, '');
const jwtSecret = required('CASHLESS_JWT_SECRET', env('CASHLESS_JWT_SECRET'));
if (jwtSecret.length < 32) throw new Error('CASHLESS_JWT_SECRET ha de tenir almenys 32 caràcters');

const config: AppConfig = {
  databaseUrl: required('SUPABASE_DB_URL', env('DATABASE_URL') ?? env('SUPABASE_DB_URL')),
  jwtSecret,
  port: 0,
  corsOrigins: (env('CORS_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  publicApiUrl: env('PUBLIC_API_URL') ?? (supabaseUrl ? `${supabaseUrl}/functions/v1/api` : 'http://localhost:8000/api'),
  apiPrefix: 'api',
};

// Poques connexions: Supabase pot tenir diverses instàncies de la funció alhora.
const db = createDb(createSql(config.databaseUrl, { max: 3 }));
const app = createApp({ db, config, clientIp: edgeClientIp });

Deno.serve(app.fetch);

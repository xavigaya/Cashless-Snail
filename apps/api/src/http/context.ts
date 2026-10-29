/** Tipus i dependències compartides per totes les rutes HTTP. */
import type { Context } from 'hono';
import type { AppConfig } from '../config';
import type { Db } from '../db/db';
import type { LedgerService } from '../ledger/ledger.service';
import type { AdminAccess } from '../admin/admin-access';
import type { AdminPrincipal, OperatorPrincipal, TerminalPrincipal } from '../auth/principals';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  ledger: LedgerService;
  access: AdminAccess;
  /** IP del client (per al límit d'intents). Depèn de l'entorn: Node o Edge. */
  clientIp: (c: Context) => string;
}

export interface AppEnv {
  Variables: {
    admin: AdminPrincipal;
    terminal: TerminalPrincipal;
    operator: OperatorPrincipal;
  };
}

export type AppContext = Context<AppEnv>;

/** Llegeix el cos JSON de la petició. Un cos buit o mal format es tracta com a objecte buit (la validació avisarà). */
export async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

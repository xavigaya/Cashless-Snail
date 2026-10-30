# Instruccions per a Claude

Projecte: plataforma cashless multi-entitat per a esdeveniments. L’usuari treballa en català: escriu en català la interfície, els missatges d’error, els comentaris i la documentació.

## Ordres

- `pnpm install` i després `pnpm build:shared` (l’API consumeix `packages/shared/dist`).
- `pnpm typecheck` — comprova tots els paquets.
- `pnpm test` — proves de punta a punta de l’API. Necessiten `TEST_DATABASE_URL` cap a una base de dades buida (s’esborra).
- `pnpm --filter @cashless/shared test` — proves de la lògica pura.
- `pnpm db:migrate`, `pnpm db:seed`.
- `pnpm --filter @cashless/api build:edge` — genera l’Edge Function de Supabase (`supabase/functions/api/api.js`, no es versiona).
- Per provar l’Edge Function: executa-la amb Deno i passa les proves amb `TEST_API_URL=http://127.0.0.1:8000/api` (vegeu `.github/workflows/ci.yml`).

## Arquitectura de l’API

- Hono + Drizzle (driver postgres-js). El mateix codi s’executa a Node (`src/main.ts`: versió local i Render) i a Deno (`src/edge.ts`: Supabase). No facis servir APIs exclusives de Node fora de `main.ts` i dels scripts de `src/db/`; per a mòduls de Node, importa’ls amb el prefix `node:` (`node:crypto`, `node:buffer`).
- Les rutes són a `src/http/routes/`; cada ruta protegida declara el seu middleware (`requireAdmin`, `requireTerminal`, `requireOperator`).

## Regles del domini (no les trenquis)

- Els diners són **enters en cèntims**. Mai `float`.
- Només `apps/api/src/ledger/ledger.service.ts` modifica saldos. Tota operació econòmica escriu un moviment a `movements` dins d’una transacció que bloqueja el saldo (`SELECT … FOR UPDATE`).
- `movements` és immutable (trigger a la base de dades). Les correccions són moviments inversos (`type = 'void'`, `reverses_movement_id`).
- L’`id` de cada operació el genera el client i garanteix la idempotència; `request_hash` detecta reutilitzacions amb dades diferents.
- La taula `wallets` és una còpia de treball: ha de coincidir sempre amb la suma dels deltes dels moviments (hi ha una prova que ho verifica).
- El saldo és per parella (polsera, entitat organitzadora).
- El saldo promocional es gasta abans que el pagat.
- Per recarregar o comprar, la polsera ha d’estar activada en l’esdeveniment: hi ha d’haver un moviment `wristband_fee` del seu saldo en aquell esdeveniment (`WRISTBAND_NOT_ACTIVATED` si no).
- Excepció: les vendes sense connexió (`LedgerService.offlineSale`, `POST /tpv/offline-sales`) ja s’han cobrat, i no es rebutgen per saldo, bloqueig o activació. Es registren amb `offline = true` i els problemes a `offline_issues`. El saldo pagat pot quedar negatiu (deute); amb deute, una venda amb connexió retorna `WRISTBAND_IN_DEBT`.
- A la taquilla, recàrregues i activacions van dins d’un torn de caixa obert de l’operador (`cash_shifts`, `movements.shift_id`; `SHIFT_NOT_OPEN` si no). Com a màxim hi ha un torn obert per terminal. `CashService` només llegeix moviments; no toca saldos.

## Esquema

Les migracions SQL de `apps/api/migrations` són la font de veritat. `apps/api/src/db/schema.ts` (Drizzle) ha de coincidir-hi. Per canviar l’esquema, afegeix un fitxer nou `000N_descripcio.sql`; no modifiquis migracions ja aplicades.

Cada taula nova ha d’activar Row Level Security (`ALTER TABLE … ENABLE ROW LEVEL SECURITY;`) sense polítiques: a Supabase, això impedeix que l’API REST pública hi accedeixi (vegeu la migració 0003).

## Errors

Els errors de negoci fan servir `DomainError` amb un codi de `ERROR_CODES` (`packages/shared/src/enums.ts`) i un missatge en català. Els clients interpreten el codi, no el missatge.

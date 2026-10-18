# Instruccions per a Claude

Projecte: plataforma cashless multi-entitat per a esdeveniments. L’usuari treballa en català: escriu en català la interfície, els missatges d’error, els comentaris i la documentació.

## Ordres

- `pnpm install` i després `pnpm build:shared` (l’API consumeix `packages/shared/dist`).
- `pnpm typecheck` — comprova tots els paquets.
- `pnpm test` — proves de punta a punta de l’API. Necessiten `TEST_DATABASE_URL` cap a una base de dades buida (s’esborra).
- `pnpm --filter @cashless/shared test` — proves de la lògica pura.
- `pnpm db:migrate`, `pnpm db:seed`.

## Regles del domini (no les trenquis)

- Els diners són **enters en cèntims**. Mai `float`.
- Només `apps/api/src/ledger/ledger.service.ts` modifica saldos. Tota operació econòmica escriu un moviment a `movements` dins d’una transacció que bloqueja el saldo (`SELECT … FOR UPDATE`).
- `movements` és immutable (trigger a la base de dades). Les correccions són moviments inversos (`type = 'void'`, `reverses_movement_id`).
- L’`id` de cada operació el genera el client i garanteix la idempotència; `request_hash` detecta reutilitzacions amb dades diferents.
- La taula `wallets` és una còpia de treball: ha de coincidir sempre amb la suma dels deltes dels moviments (hi ha una prova que ho verifica).
- El saldo és per parella (polsera, entitat organitzadora).
- El saldo promocional es gasta abans que el pagat.
- Per recarregar o comprar, la polsera ha d’estar activada en l’esdeveniment: hi ha d’haver un moviment `wristband_fee` del seu saldo en aquell esdeveniment (`WRISTBAND_NOT_ACTIVATED` si no).

## Esquema

Les migracions SQL de `apps/api/migrations` són la font de veritat. `apps/api/src/db/schema.ts` (Drizzle) ha de coincidir-hi. Per canviar l’esquema, afegeix un fitxer nou `000N_descripcio.sql`; no modifiquis migracions ja aplicades.

## Errors

Els errors de negoci fan servir `DomainError` amb un codi de `ERROR_CODES` (`packages/shared/src/enums.ts`) i un missatge en català. Els clients interpreten el codi, no el missatge.

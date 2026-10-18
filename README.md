# Cashless Snail

Plataforma cashless multi-entitat per a esdeveniments (festes majors, fires, festivals) de 500 a 10.000 persones.
Es paga amb polsera NFC o QR; el saldo, en euros, es guarda al servidor.

> **Estat: fase 0 (prototip).** Servidor i backoffice provats; l’app TPV compila però falta provar-la en mòbils reals amb NFC.

## Com està organitzat

```
apps/
  api/          Servidor central (NestJS + PostgreSQL): llibre de moviments, permisos, API
  backoffice/   Web de configuració (React + Vite)
  tpv/          App de terminal per a Android i iPhone (Expo / React Native) amb NFC i QR
packages/
  shared/       Tipus, validacions i càlculs compartits per totes les aplicacions
docs/           Documentació del projecte
```

Jerarquia de dades: **Entitat** organitzadora → **Esdeveniment** → **Venedors** (cada un amb la seva liquidació) → **Punts de venda** (barra, cuina, taquilla) → **Terminals** i **Operadors**.

Principis del disseny:

- **Llibre de moviments immutable.** Cada recàrrega, venda o anul·lació és un moviment que no es pot modificar ni esborrar (ho impedeix la base de dades). Una correcció és un moviment invers.
- **Sense duplicats.** Cada operació porta un identificador generat pel terminal: si es repeteix (per exemple, perquè es va perdre la connexió), el servidor retorna el resultat original.
- **Imports en cèntims** (enters), mai amb decimals.
- **El saldo pertany a l’entitat organitzadora**, no a la polsera en general: una polsera es pot reutilitzar en esdeveniments de diverses entitats, cadascuna amb el seu saldo.
- **Saldo promocional i saldo pagat separats:** el promocional (regals, voluntaris) es gasta primer i no es retorna.
- **Activació per esdeveniment:** per recarregar o comprar, la polsera s’ha d’haver activat (preu de polsera pagat) en aquell esdeveniment, encara que ja tingui saldo d’un altre esdeveniment de la mateixa entitat.

## Requisits

- Node.js 22 o superior i [pnpm](https://pnpm.io) 10
- PostgreSQL 16 (o Docker per arrencar-lo amb `docker compose up -d`)
- Per a l’app TPV: Android Studio o Xcode per compilar-la (la lectura NFC no funciona dins d’Expo Go)

## Posada en marxa

```bash
pnpm install
pnpm build:shared

# Base de dades
docker compose up -d
cp apps/api/.env.example apps/api/.env      # i edita'l
pnpm db:migrate
pnpm db:seed                                # dades de demostració

# Servidor i backoffice
pnpm dev:api                                # http://localhost:3000
cp apps/backoffice/.env.example apps/backoffice/.env
pnpm dev:backoffice                         # http://localhost:5173
```

El `seed` crea un administrador de plataforma (per defecte `admin@cashless.local`), una entitat i un esdeveniment actiu amb dos venedors, una barra, una cuina, una taquilla, productes, quatre operadors i tres terminals. Mostra per pantalla els PIN i els codis de vinculació.

| Operador de demo | Rol | PIN |
| --- | --- | --- |
| Anna | Cap de barra | 1111 |
| Marc | Caixer | 2222 |
| Laia | Cambrera | 3333 |
| Pere | Taquiller | 4444 |

### App TPV

```bash
cd apps/tpv
npx expo install --fix      # ajusta les versions a l'SDK d'Expo instal·lat
npx expo run:android        # o: npx expo run:ios
```

Per vincular un mòbil: al backoffice, obre l’esdeveniment → *Operadors i terminals* i escaneja el QR del terminal amb l’app.
El mòbil ha de poder arribar a l’adreça de `PUBLIC_API_URL` (en proves, la IP del teu ordinador a la xarxa local, no `localhost`).

### Proves

Les proves del servidor fan servir una base de dades PostgreSQL **buida i dedicada** (s’esborra a cada execució):

```bash
createdb cashless_test
TEST_DATABASE_URL=postgres://usuari@localhost:5432/cashless_test pnpm test
pnpm --filter @cashless/shared test         # lògica pura (preus, saldos, codis)
```

## Estat

Fase 0 — prototip:

| Peça | Estat |
| --- | --- |
| Esquema de base de dades i restriccions | Provat contra PostgreSQL 16 |
| Lògica compartida (preus, saldos, codis de polsera) | Provada |
| Servidor: llibre de moviments, vendes, recàrregues, activació, anul·lacions | 24 proves de punta a punta en verd, incloses concurrència i duplicats |
| Servidor: backoffice (entitats, esdeveniments, catàleg, operadors, terminals, resum) | Provat amb les mateixes proves i manualment |
| Backoffice web | Provat en navegador (ordinador i mòbil) |
| App TPV (venda, taquilla, NFC, QR) | Compila i s’empaqueta per a Android; **falta provar-la en dispositius reals** |

Qüestions obertes:

- Els administradors es creen amb una contrasenya inicial que tria qui els dona d’alta. A la fase 2 caldrà substituir-ho per una invitació per correu.

Fases següents (vegeu el document d’especificacions): esdeveniment real (multi-venedor complet, cuina amb impressora, funcionament offline, informes PDF i Excel), servei a entitats (recàrrega online, devolucions, promocions, estoc) i escala (node local, analítica, Verifactu).

## API en resum

| Àmbit | Rutes principals |
| --- | --- |
| Autenticació | `POST /auth/login`, `GET /auth/me` |
| Entitats | `GET/POST /organizations`, `POST /organizations/:id/admins`, `GET/POST /organizations/:id/events` |
| Esdeveniment | `GET/PATCH /events/:id`, `GET /events/:id/summary`, `GET /events/:id/movements`, `POST /events/:id/voids` |
| Catàleg | `/events/:id/vendors`, `/events/:id/points-of-sale`, `/events/:id/products` |
| Equip | `/events/:id/operators`, `/events/:id/terminals`, `POST /events/:id/terminals/:tid/pairing-code` |
| Polseres | `GET /events/:id/wristbands/lookup`, `PATCH /events/:id/wristbands/:wid/status` |
| Terminal | `POST /tpv/pair`, `GET /tpv/context`, `POST /tpv/login`, `GET /tpv/catalog`, `GET /tpv/balance`, `POST /tpv/sales`, `POST /tpv/topups`, `POST /tpv/activations`, `POST /tpv/voids`, `GET /tpv/recent` |

Els terminals s’identifiquen amb la capçalera `X-Terminal-Token`; els operadors i els administradors, amb `Authorization: Bearer <token>`.

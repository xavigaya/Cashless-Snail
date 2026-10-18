# Com provar-ho tot

Guia per provar la fase 0 al teu ordinador i en un mòbil Android amb NFC.

## 1. Què cal tenir instal·lat

| Per a | Cal |
| --- | --- |
| Servidor i backoffice | [Git](https://git-scm.com), [Node.js 22](https://nodejs.org) i [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| pnpm | Després d’instal·lar Node: `corepack enable` |
| App TPV | [Android Studio](https://developer.android.com/studio) (instal·la l’SDK d’Android i el JDK que porta) |
| Mòbil | Un Android amb NFC, amb les *opcions de desenvolupador* i la *depuració USB* activades |
| Polseres | Polseres, targetes o adhesius NFC (NTAG213/215 o NTAG 424 DNA). Per començar, serveix qualsevol adhesiu NFC barat |

Si no tens polseres NFC, també pots provar-ho amb el codi imprès: a l’app tria **Escriu el codi** i posa qualsevol codi de 10 caràcters, per exemple `ABCDE-FGHJK`.

## 2. Servidor i backoffice

```bash
git clone https://github.com/xavigaya/cashless-snail
cd cashless-snail
pnpm install
pnpm build:shared

docker compose up -d          # arrenca PostgreSQL
```

Crea el fitxer `apps/api/.env` copiant `apps/api/.env.example` i canvia aquestes línies:

```
DATABASE_URL=postgres://cashless:cashless@localhost:5432/cashless
PUBLIC_API_URL=http://192.168.1.50:3000
```

A `PUBLIC_API_URL` hi has de posar **la IP del teu ordinador a la xarxa wifi**, no `localhost`, perquè el mòbil s’hi ha de poder connectar. La trobes amb `ipconfig` (Windows) o `ipconfig getifaddr en0` (Mac).

```bash
pnpm db:migrate
pnpm db:seed                  # mostra els PIN i els codis de vinculació
pnpm dev:api                  # deixa-ho obert
```

En una altra finestra del terminal:

```bash
cp apps/backoffice/.env.example apps/backoffice/.env
pnpm dev:backoffice
```

Obre http://localhost:5173 i entra amb `admin@cashless.local` / `canvia-aquesta-contrasenya`.

## 3. App TPV al mòbil

1. Connecta el mòbil a l’ordinador amb el cable USB i accepta el missatge de depuració al mòbil.
2. El mòbil i l’ordinador han d’estar a la **mateixa wifi**.
3. Compila i instal·la l’app (la primera vegada triga uns minuts):

```bash
cd apps/tpv
npx expo run:android
```

4. A l’app, escaneja el QR del terminal. El trobaràs al backoffice, a *Festa Major (demo) → Operadors i terminals*. Si el codi ha caducat, prem **Nou codi**.

Si el mòbil no troba el servidor, revisa `PUBLIC_API_URL` i que el tallafoc de l’ordinador permeti connexions al port 3000.

## 4. Recorregut de prova

Amb un sol mòbil, vincula’l primer a la **Taquilla 1**. Després prem **Desvincula** i vincula’l a la **Barra 1**. Amb dos mòbils, pots tenir-ne un a cada lloc.

**A la taquilla** (Pere, PIN `4444`):

1. *Llegeix una polsera* → apropa-la. Ha de sortir **Polsera nova**.
2. *Activa · 1,00 €* → pantalla verda.
3. Tria 10 € i *Recarrega* → saldo 10,00 €.

**A la barra** (Marc, PIN `2222`):

4. Toca *Cervesa* dues vegades → *Cobra* → apropa la polsera. Ha de sortir verd, amb 6,00 € i un saldo restant de 4,00 €.
5. Prova de cobrar més del que queda: ha de sortir vermell amb **Saldo insuficient**.
6. *Saldo* → apropa la polsera: 4,00 €.

**Anul·lació** (surt i entra com a Anna, PIN `1111`):

7. *Anul·la* → tria la venda → el saldo torna a 10,00 €.

**Al backoffice:**

8. A *Resum*, les xifres s’actualitzen soles cada 15 segons.
9. A *Moviments*, hi ha d’haver l’activació, la recàrrega, la venda (marcada com a anul·lada) i l’anul·lació.
10. A *Polseres*, cerca el codi de la polsera i prem *Bloqueja*. Torna a la barra i prova de cobrar: ha de sortir **Polsera bloquejada**.

**Activació per esdeveniment:**

11. Crea un segon esdeveniment a la mateixa entitat, amb una taquilla, un taquiller i un terminal, i activa’l. Llegeix la mateixa polsera: ha de mostrar el saldo, però també l’avís que no està activada en aquest esdeveniment. No es pot recarregar fins que no s’hi activi.

## 5. Proves automàtiques

```bash
docker compose exec postgres createdb -U cashless cashless_test
TEST_DATABASE_URL=postgres://cashless:cashless@localhost:5432/cashless_test pnpm test
pnpm --filter @cashless/shared test
```

A Windows (PowerShell), la variable es posa així:

```powershell
$env:TEST_DATABASE_URL="postgres://cashless:cashless@localhost:5432/cashless_test"; pnpm test
```

## iPhone

Per instal·lar l’app en un iPhone calen un Mac amb Xcode i un compte de desenvolupador d’Apple, perquè la lectura NFC requereix un permís especial. Recomano començar amb Android.

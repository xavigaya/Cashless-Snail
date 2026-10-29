# Versió 100% online i gratuïta: Supabase + GitHub Pages

Amb aquesta configuració no cal cap ordinador ni servidor propi, i no té cap cost:

| Peça | On s’executa |
| --- | --- |
| Base de dades | PostgreSQL de [Supabase](https://supabase.com), a Frankfurt (UE) |
| API (servidor) | Una Edge Function de Supabase anomenada `api` |
| Backoffice | [GitHub Pages](https://pages.github.com), a `https://<usuari>.github.io/Cashless-Snail/` |
| App TPV | La mateixa APK de sempre: només canvia l’adreça del QR de vinculació |
| Desplegament | GitHub Actions, automàtic a cada canvi |

El codi de l’API és el mateix que el de la versió local: es pot fer servir una versió, l’altra o totes dues.

## Limitacions del pla gratuït de Supabase

Abans de fer-hi un esdeveniment real, tingues en compte:

- **Pausa per inactivitat.** Supabase posa en pausa el projecte si passa una setmana sense activitat. El workflow «Manté Supabase actiu» fa una consulta cada 3 dies per evitar-ho. Si tot i així es posa en pausa, les dades no es perden: al panell de Supabase, obre el projecte i prem **Resume project**.
- **Sense còpies de seguretat automàtiques.** Fes-ne una abans i després de cada esdeveniment (vegeu [Còpies de seguretat](#còpies-de-seguretat)).
- **500 MB de base de dades i 2 projectes actius.** És molt més del que necessita aquest sistema.
- **GitHub desactiva les tasques programades** d’un repositori que fa 60 dies que no té canvis, i avisa per correu. Si passa, torna-la a activar a la pestanya **Actions**.

El pla Pro de Supabase (uns 25 $/mes) treu la pausa i inclou còpies de seguretat diàries.

## 1. Crea el projecte a Supabase

1. Crea un compte a https://supabase.com.
2. **New project**:
   - Nom: `cashless-snail`, o el que vulguis.
   - Contrasenya de la base de dades: genera’n una de llarga i **desa-la**, perquè la necessitaràs al pas 2.
   - Regió: **Central EU (Frankfurt)**.
3. Quan el projecte estigui a punt, copia’n l’identificador (*Project ref*). És la part de l’adreça del panell que va després de `/project/`, una cadena de 20 lletres, per exemple `abcdefghijklmnopqrst`.

## 2. Recull les dades que necessita GitHub

**Cadena de connexió.** Al projecte, prem **Connect**, a dalt de tot, i copia la de **Session pooler**. Té aquest format:

```
postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-<n>-eu-central-1.pooler.supabase.com:5432/postgres
```

Substitueix `[YOUR-PASSWORD]` per la contrasenya del pas 1. Ha de ser la de **Session pooler** i no la *Direct connection*, perquè GitHub Actions només es pot connectar per IPv4.

**Token d’accés.** Ves a https://supabase.com/dashboard/account/tokens i crea un token limitat al teu projecte amb aquests permisos:
- **Edge Functions**: *Read-write*
- **Edge Function Secrets**: *Read-write*

**Clau de sessions.** És una cadena aleatòria d’almenys 32 caràcters. La pots generar amb:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. Configura el repositori de GitHub

Al repositori, ves a **Settings → Secrets and variables → Actions**.

A la pestanya **Secrets**, crea:

| Secret | Valor |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | El token d’accés |
| `SUPABASE_DB_URL` | La cadena de connexió *Session pooler*, amb la contrasenya |
| `CASHLESS_JWT_SECRET` | La clau de sessions |
| `BOOTSTRAP_ADMIN_EMAIL` | El teu correu (serà l’administrador de plataforma) |
| `BOOTSTRAP_ADMIN_PASSWORD` | La teva contrasenya inicial (mínim 12 caràcters) |

A la pestanya **Variables**, crea:

| Variable | Valor |
| --- | --- |
| `SUPABASE_PROJECT_REF` | L’identificador del projecte |

Si publiques el backoffice en una altra adreça (un domini propi, per exemple), afegeix també la variable `CORS_ORIGINS` amb aquella adreça. Per defecte s’accepta `https://<usuari>.github.io`.

**Activa GitHub Pages:** ves a **Settings → Pages → Build and deployment → Source** i tria **GitHub Actions**.

## 4. Desplega

A la pestanya **Actions** del repositori:

1. **Desplega a Supabase → Run workflow.** Aplica les migracions, crea el teu usuari administrador, desplega l’API i comprova que respon. Triga uns 2 minuts.
2. **Backoffice a GitHub Pages → Run workflow.** Compila el backoffice i el publica.

A partir d’aquí, tots dos es tornen a executar sols cada vegada que es puja un canvi a `main`.

Obre `https://<usuari>.github.io/Cashless-Snail/` (per exemple, https://xavigaya.github.io/Cashless-Snail/) i entra amb el correu i la contrasenya de `BOOTSTRAP_ADMIN_EMAIL` i `BOOTSTRAP_ADMIN_PASSWORD`.

L’API queda a `https://<project-ref>.supabase.co/functions/v1/api`. Per comprovar que funciona, obre `…/functions/v1/api/health`.

## 5. Terminals

Fes servir la mateixa APK de l’app TPV. Al backoffice, crea un terminal i escaneja’n el QR: ja porta l’adreça de Supabase.

Els mòbils necessiten connexió a internet durant l’esdeveniment, per dades mòbils o per wifi. Si la cobertura és dolenta, és millor la versió local amb el router propi.

## Còpies de seguretat

El pla gratuït no en fa. Fes-ne una abans i després de cada esdeveniment, des de qualsevol ordinador amb Docker:

```bash
docker run --rm -v "$PWD:/copia" postgres:17 \
  pg_dump "<cadena Session pooler amb la contrasenya>" \
  --no-owner --no-privileges --format=custom --file=/copia/cashless-$(date +%F).dump
```

Desa el fitxer en un lloc segur, perquè conté dades personals i econòmiques.

## Seguretat

- **API de Supabase tancada.** Supabase publica automàticament una API REST de les taules amb una clau pública. La migració `0003_tancar_api_publica.sql` activa *Row Level Security* a totes les taules i retira els permisos als rols públics, de manera que només l’Edge Function hi té accés. Al panell, *Advisors → Security* no ha de mostrar cap avís de taules exposades.
- **Autenticació pròpia.** L’Edge Function no fa servir l’autenticació de Supabase (`verify_jwt = false`): els administradors, els terminals i els operadors s’autentiquen amb el sistema de l’API, igual que a la versió local.
- **Límit d’intents.** Per adreça i minut: 10 inicis de sessió al backoffice, 60 entrades amb PIN i 30 vinculacions de terminal. A Supabase el comptador és per instància de la funció; per això els bloquejos importants es guarden a la base de dades i són exactes: un compte del backoffice es bloqueja 15 minuts després de 10 contrasenyes errònies, i un operador després de 5 PIN erronis.
- **Mida de les peticions.** L’API rebutja els cossos de més de 100 KB i només llegeix els que són `application/json`.
- **Tot va per HTTPS**, i les dades es guarden a la UE (Frankfurt).

## Si alguna cosa no funciona

| Problema | Solució |
| --- | --- |
| Els workflows apareixen com a *skipped* | Falta la variable `SUPABASE_PROJECT_REF` (ha de ser una variable, no un secret) |
| «Falten secrets del repositori» | Revisa els noms dels secrets del pas 3 |
| `Invalid access token` en desplegar | El token ha caducat o no té els permisos de *Edge Functions* i *Edge Function Secrets* |
| La migració no es pot connectar | Fes servir la cadena *Session pooler* (port 5432, usuari `postgres.<project-ref>`), amb la contrasenya |
| El backoffice diu «No es pot connectar amb el servidor» | Mira si el projecte està en pausa, i si `CORS_ORIGINS` coincideix amb l’adreça del backoffice |
| El projecte està en pausa | Al panell de Supabase, **Resume project** |

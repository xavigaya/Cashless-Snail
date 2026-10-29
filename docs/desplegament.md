# Desplegament 100% online amb Render

> Hi ha una alternativa gratuïta amb Supabase i GitHub Pages: vegeu [supabase.md](supabase.md).

Amb aquesta configuració no cal cap ordinador ni servidor propi:

| Peça | On s’executa |
| --- | --- |
| Servidor (API) i backoffice | [Render](https://render.com), un sol servei web a Frankfurt (UE) |
| Base de dades | PostgreSQL gestionat per Render, a Frankfurt |
| Compilació de l’app TPV | Al núvol d’[Expo (EAS)](https://expo.dev), llançada des de GitHub |
| Proves automàtiques | GitHub Actions, a cada canvi |
| Terminals | Els mòbils dels voluntaris o els terminals propis, connectats per internet |

El servidor publica l’API a `https://<el-teu-servei>.onrender.com/api` i el backoffice a l’arrel, `https://<el-teu-servei>.onrender.com`.

## Cost orientatiu

Amb els plans més petits de pagament de Render (preus d’octubre de 2026): servei web de 512 MB, 7 $/mes, i PostgreSQL de 256 MB, 6 $/mes. En total, uns **13 $/mes**.

Els plans gratuïts no són adequats per a un esdeveniment, perquè el servei s’atura quan no té activitat. Abans d’un esdeveniment gran, puja el pla del servei i de la base de dades des del panell de Render, i baixa’l després.

Expo permet un nombre limitat de compilacions gratuïtes al mes, que són suficients per a aquest projecte.

## 1. Servidor i backoffice a Render

1. Crea un compte a https://render.com i connecta’l amb el teu compte de GitHub.
2. Al panell de Render: **New → Blueprint** i tria el repositori `xavigaya/cashless-snail`. Render llegirà el fitxer `render.yaml`.
3. Et demanarà dos valors per al primer administrador de plataforma:
   - `BOOTSTRAP_ADMIN_EMAIL`: el teu correu.
   - `BOOTSTRAP_ADMIN_PASSWORD`: una contrasenya d’almenys 12 caràcters.
4. Prem **Apply**. Render crearà la base de dades i el servei. El primer desplegament triga uns minuts.
5. Quan acabi, obre l’adreça del servei (`https://cashless-xxxx.onrender.com`) i entra amb el correu i la contrasenya del pas 3.

A partir d’aquí, cada vegada que es puja un canvi a la branca `main` de GitHub, Render el desplega sol. Abans de cada desplegament aplica les migracions de la base de dades.

Si vols una adreça pròpia (per exemple, `cashless.lamevaentitat.cat`), afegeix-la a *Settings → Custom Domains* del servei.

### Variables d’entorn que configura el Blueprint

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | La connexió a la base de dades, automàtica |
| `JWT_SECRET` | Generada a l’atzar per Render |
| `API_PREFIX` | `api` |
| `BACKOFFICE_DIST` | `apps/backoffice/dist` (el servidor serveix el backoffice) |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | Primer administrador. Només s’usen si encara no n’hi ha cap |

L’adreça pública que va dins del QR de vinculació dels terminals es calcula sola a partir de l’adreça del servei.

## 2. App TPV compilada al núvol

### Preparació (una sola vegada)

1. Crea un compte a https://expo.dev.
2. A expo.dev, crea un projecte nou anomenat `cashless-tpv` i copia’n el **Project ID**.
3. A expo.dev, ves a *Account settings → Access tokens* i crea un token.
4. A GitHub, al repositori, ves a *Settings → Secrets and variables → Actions*:
   - A **Secrets**, crea `EXPO_TOKEN` amb el token del pas 3.
   - A **Variables**, crea `EXPO_PROJECT_ID` amb el Project ID del pas 2.
   - Si el projecte és d’una organització d’Expo i no del teu compte personal, crea també la variable `EXPO_OWNER` amb el nom de l’organització.

### Compilar una versió

1. A GitHub: **Actions → App TPV Android → Run workflow**, amb el perfil `preview`.
2. La compilació es fa a expo.dev i triga uns 10–20 minuts. La pots seguir a la pestanya *Builds* del projecte.
3. Quan acabi, expo.dev mostra un enllaç i un QR. Obre’l des del mòbil Android, descarrega l’APK i instal·la’l. Caldrà permetre la instal·lació d’aplicacions d’aquest origen.

Envia el mateix enllaç als voluntaris perquè la instal·lin als seus mòbils.

### Vincular els terminals

Al backoffice, a l’esdeveniment → *Operadors i terminals*, crea un terminal i escaneja el QR amb l’app. El QR ja inclou l’adreça del servidor del núvol.

### iPhone

Per a iPhone cal un compte de desenvolupador d’Apple (de pagament). Amb aquest compte, EAS compila l’app al núvol i la pot distribuir per TestFlight. Ho podem preparar quan calgui.

## 3. Proves automàtiques

El fitxer `.github/workflows/ci.yml` executa a GitHub, a cada canvi, la comprovació de tipus i totes les proves contra una base de dades PostgreSQL temporal. Els resultats es veuen a la pestanya **Actions** del repositori.

## Seguretat

- Tot el trànsit va xifrat (HTTPS) amb el certificat que posa Render.
- Les rutes d’entrada (contrasenya, PIN i vinculació) accepten un màxim de 10 intents per minut i per adreça IP.
- Les dades es guarden a la Unió Europea (Frankfurt).
- Les còpies de seguretat de la base de dades depenen del pla de Render: revisa-ho abans del primer esdeveniment real.

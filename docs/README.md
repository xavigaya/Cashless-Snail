# Documentació

- **[Com provar-ho tot](com-provar.md)**: instal·lació, app al mòbil i recorregut de prova
- **Especificacions del sistema** (decisions, arquitectura, model de dades, fases i punts legals a validar):
  document de treball a claude.ai — https://claude.ai/code/artifact/3aa0b93d-498a-463a-8499-5ca9f2c67308

## Fases

| Fase | Contingut | Porta per passar a la següent |
| --- | --- | --- |
| 0 · Prototip | Llibre de moviments, backoffice mínim, app TPV online amb NFC i QR, recàrrega a taquilla | Una barra i una taquilla funcionen una tarda sense errors |
| 1 · Primer esdeveniment real | Multi-venedor, anul·lacions validades, comandes a cuina amb impressora, offline amb límits, tancament de caixa, informes PDF/Excel | Validació legal feta i pilot de 500 persones quadrat |
| 2 · Servei a entitats | Recàrrega online i passarel·les configurables, devolucions, promocions, estoc, web pública | Una entitat externa fa un esdeveniment tota sola |
| 3 · Escala | Node local sense cobertura, analítica entre edicions, Verifactu, pantalla de cuina | — |

## Decisions tècniques de la fase 0

- **Monorepo pnpm** amb un paquet compartit (`@cashless/shared`) perquè servidor, backoffice i TPV facin servir els mateixos tipus i validacions.
- **NestJS + Drizzle + PostgreSQL**. Les migracions són SQL escrit a mà (`apps/api/migrations`), sense generador, perquè les restriccions de diners (saldos no negatius, moviments immutables) quedin explícites a la base de dades.
- **Autenticació**: administradors amb JWT (12 h); terminals amb un token aleatori llarg desat al dispositiu (només se’n guarda el hash al servidor); operadors amb PIN de 4–6 xifres (bloqueig de 5 minuts després de 5 intents fallits).
- **Vinculació de terminals**: el backoffice genera un codi de 8 caràcters vàlid 30 minuts, que es mostra també com a QR (inclou l’adreça del servidor).
- **App TPV**: Expo amb *development build* (la lectura NFC no funciona a Expo Go). La polsera s’identifica per l’UID del xip; el QR i el codi imprès són l’alternativa.

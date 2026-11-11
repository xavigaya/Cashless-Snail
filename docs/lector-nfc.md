# Lector NFC USB (ACR122U)

Amb un lector USB, com l’**ACR122U** o qualsevol lector PC/SC, el backoffice pot llegir polseres directament des d’un ordinador. Serveix per:

- **Consultar una polsera** en un punt d’informació: l’apropes al lector i en surten el saldo i els moviments. Des d’allà la pots bloquejar o marcar com a perduda.
- **Registrar polseres per endavant** (*mode registre*): cada polsera que s’apropa queda registrada al sistema, sense saldo, i se n’assigna el codi imprès. Va bé quan arriba un lot nou del proveïdor.

Els TPV de barra i taquilla continuen sent els mòbils, perquè ja porten NFC.

## Com funciona

El navegador no pot parlar directament amb un lector de targetes. Per això, a l’ordinador on hi ha el lector cal tenir obert un programa petit, **«Lector NFC de Cashless Snail»** (`cashless-lector-nfc.exe`). El programa:

1. Llegeix l’UID de cada polsera que s’apropa al lector.
2. L’envia al backoffice per una connexió interna de l’ordinador (`http://127.0.0.1:17321`), que no surt a internet.
3. Només accepta connexions de les adreces del backoffice. Cap altra pàgina web pot saber quines polseres llegeix.

## Instal·lació a Windows

1. Connecta l’ACR122U. Windows el reconeix sol. Si no, instal·la el controlador PC/SC de la web d’ACS («ACR122U Driver»).
2. Copia `cashless-lector-nfc.exe` a l’ordinador i obre’l. Com que el programa no està signat, Windows pot avisar: *Més informació → Executa igualment*. S’obre una finestra que diu «Escoltant a http://127.0.0.1:17321». Deixa-la oberta.
3. Al backoffice, ves a l’esdeveniment, pestanya **Polseres**, i prem **Fes servir un lector USB**. Si el navegador pregunta si la pàgina pot accedir a dispositius de la xarxa local, accepta.
4. Quan surti el punt verd («Lector USB a punt»), apropa una polsera. El lector fa un xiulet i el backoffice en mostra el detall.

L’opció queda recordada en aquell navegador. A la barra superior, el punt **NFC** indica l’estat del lector:
- **verd:** a punt;
- **taronja:** falta el programa o el lector.

## Altres sistemes i opcions

- **Linux i macOS.** Cal compilar el programa amb el suport PC/SC: `cd apps/lector-nfc && go build -tags pcsc` (a Linux cal `libpcsclite-dev` i el servei `pcscd`).
- **Compilar l’executable de Windows des de qualsevol sistema:** `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o cashless-lector-nfc.exe .`
- **Opcions del programa:**
  - `-port`: el port (per defecte, 17321);
  - `-origen`: les adreces del backoffice que s’hi poden connectar, separades per comes;
  - `-lector`: el nom del lector, si n’hi ha més d’un.

## Comprovació important

Abans d’un esdeveniment, comprova que una mateixa polsera dona **el mateix UID** a l’ACR122U i al mòbil:
1. Registra-la amb el lector USB.
2. Llegeix-la a la taquilla amb el mòbil.

Ha de sortir com a polsera registrada, no com a «Polsera nova».

## I escriure a les polseres?

De moment el sistema **no escriu res a les polseres**, i no li cal. Cada polsera s’identifica per l’UID del xip, que ve gravat de fàbrica i no es pot copiar fàcilment. El saldo és al servidor, mai al xip: si algú manipula el xip, no pot inventar-se saldo.

Escriure-hi només tindria sentit per a tres coses, i es podrà afegir més endavant:

1. **Que els assistents consultin el seu saldo amb el seu mòbil.** Es gravaria a la polsera un enllaç (NDEF) a una pàgina pública amb el saldo i la recàrrega online. És el que té més sentit, i aniria amb la recàrrega online (fase 3).
2. **Gravar el codi imprès dins del xip,** per a lectors que només llegeixen NDEF. Amb l’UID no cal.
3. **Bloquejar el xip contra escriptura,** perquè ningú hi pugui gravar res després. Es fa en el mateix moment que l’enllaç.

# Importar i exportar

Cada secció del backoffice té els botons **Exporta** i **Importa…**:

- *Venedors i productes:* venedors, punts de venda i productes.
- *Operadors i terminals:* operadors i terminals.
- *Polseres:* polseres.

Els fitxers són CSV separats per punt i coma, i s’obren directament amb l’Excel.

**Fer una plantilla.** Exportar descarrega el que hi ha, amb les mateixes columnes que s’importen. Un esdeveniment buit dona un fitxer amb només la capçalera.

**Copiar un esdeveniment.** Exporta les seccions de l’esdeveniment de l’any passat i importa-les al nou, en aquest ordre:
1. venedors;
2. punts de venda;
3. productes;
4. operadors;
5. terminals.

## Com funciona la importació

- Els elements es relacionen **pel nom**, sense distingir majúscules. Si ja n’hi ha un amb el mateix nom, s’actualitza; si no, es crea. Un producte s’identifica pel nom dins del seu venedor.
- Abans d’importar es mostra una vista prèvia, amb els errors indicats per número de fila.
- La importació es fa **sencera o no es fa**: si una fila falla, no es desa res.
- La primera fila ha de ser la capçalera. L’ordre de les columnes no importa, i les columnes que no es reconeixen s’ignoren.

| Fitxer | Columnes |
| --- | --- |
| Venedors | Nom; Comissió (%) |
| Punts de venda | Nom; Tipus (Barra, Cuina o Taquilla); Venedor (cal per a barres i cuines); Actiu (sí/no) |
| Productes | Venedor; Nom; Preu (€); IVA (%); Categoria; Color (#RRGGBB); Destinació (Barra o Cuina); Ordre; Actiu |
| Operadors | Nom; Rol (Cap de barra, Caixer, Cambrer o Taquiller); PIN; Actiu |
| Terminals | Nom; Punt de venda; Actiu |
| Polseres | Codi i/o UID |

Detalls de cada tipus:
- **Operadors.** Els PIN no s’exporten, perquè només se’n guarda una versió xifrada. Per a un operador nou, el PIN és obligatori. Si es deixa buit en un operador que ja existeix, no canvia.
- **Terminals.** Cada terminal nou rep un codi de vinculació, vàlid 30 minuts. Se’n pot demanar un altre des del backoffice.
- **Polseres.** Serveix per registrar per endavant la llista d’UID que dona el proveïdor. Es creen sense saldo, i les que ja estaven registrades no canvien. L’exportació inclou també l’estat, el saldo, el deute i el nombre de moviments de cada polsera en l’esdeveniment.

## Editar i esborrar

Venedors, punts de venda, productes, operadors i terminals tenen els botons **Edita** i **Esborra**.

Només es pot esborrar un element sense història: si ja té moviments, o altres dades que en depenen, el sistema no ho deixa fer. En aquest cas, cal **desactivar-lo** (o *retirar-lo*, si és un producte), perquè els informes quedin intactes.

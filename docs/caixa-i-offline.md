# Caixa i vendes sense connexió

## Vendes sense connexió

Si un TPV de barra o de cuina perd la xarxa, pot continuar cobrant:

- **Límit.** Es pot cobrar fins a un màxim per venda i per polsera en aquell terminal. Per defecte és de 20 €, i es canvia a *Configuració → Límit sense connexió*. Si poses 0, no es pot cobrar sense connexió.
- **Al mòbil.** La venda es desa al mòbil, i la pantalla de resultat surt **taronja** en lloc de verda. A dalt s’indica quantes vendes queden pendents d’enviar.
- **Quan torna la xarxa.** El TPV les envia sol cada 15 segons, encara que l’operador hagi sortit. Si la venda sí que havia arribat al servidor però el mòbil no n’havia rebut la resposta, no es duplica.
- **Si el mòbil es reinicia.** Mentre no hi ha xarxa, el TPV obre amb el catàleg i la sessió de l’operador que tenia desats (vàlida 12 hores). No es pot canviar d’operador sense connexió, perquè el PIN es comprova al servidor.
- **Desvincular.** Un terminal amb vendes pendents no es pot desvincular, perquè es perdrien.

Quan la venda arriba al servidor, es registra **sempre**, perquè el producte ja s’ha servit. Es fa amb el preu que es va cobrar. Les possibles incidències queden anotades a la venda:

| Incidència | Què vol dir |
| --- | --- |
| Saldo insuficient (deute) | El saldo no arribava. La polsera queda amb deute i no pot tornar a comprar fins que recarregui. La recàrrega primer paga el deute. |
| La polsera ja tenia deute | Ja tenia deute d’una venda anterior sense connexió. |
| Polsera bloquejada | Estava bloquejada o marcada com a perduda. |
| Polsera desconeguda / no activada | No s’havia activat a la taquilla en aquest esdeveniment. |
| Preu diferent de l’actual | El preu del producte ha canviat des que el TPV va descarregar el catàleg. |
| Producte desactivat o d’un altre venedor / Esdeveniment no actiu | S’han canviat mentre el TPV estava sense xarxa. |
| Operador desconegut / sense permís de venda | L’operador que va vendre s’ha esborrat o se li ha canviat el rol. |

Al backoffice:
- a *Moviments*, el filtre *Sense connexió → Amb incidències* mostra les vendes a revisar;
- al *Resum* surten el nombre de vendes sense connexió i el deute pendent;
- a *Polseres* es veu el deute de cada polsera.

El servidor només rebutja una venda sense connexió en tres casos: si supera el límit de l’esdeveniment (el TPV ja ho impedeix, així que només passaria amb un terminal defectuós o manipulat), si porta un producte que no és de l’esdeveniment, o si arriba més de 7 dies després del final de l’esdeveniment. Cap venda pot superar els 1.000 €. Les vendes rebutjades queden a l’auditoria i se’n mostra el nombre al *Resum*. Al TPV surt un botó vermell ⚠ amb la llista, perquè el cap de barra la comuniqui a l’organització. Una venda que falla no bloqueja l’enviament de les altres.

**Risc assumit:** sense connexió, el TPV no sap el saldo real de la polsera. El límit acota el que es pot perdre si algú gasta més del que té, o si gasta el mateix saldo a diverses barres alhora.

## Caixa de taquilla

Tot el que es cobra a la taquilla (polseres, fiances i recàrregues) va dins d’un **torn de caixa**:

1. **Obrir.** En entrar, el taquiller compta el fons de canvi del calaix i obre la caixa.
2. **Tancar.** En acabar, prem *Tanca caixa* i escriu l’efectiu comptat. El recompte és a cegues: l’app no mostra l’import esperat fins després de declarar-lo. Després surt si quadra, si falta o si sobra, i el total cobrat amb targeta, per quadrar-lo amb el datàfon.
3. **Relleu.** Cada taquilla té un sol calaix. Si un company troba la caixa oberta per un altre, primer compta i tanca aquell torn, i després obre el seu.
4. **Torn oblidat.** Si un taquiller marxa sense tancar, es pot tancar des del backoffice, a *Caixa → Tanca*.

**Efectiu esperat** = fons de canvi + efectiu cobrat durant el torn (polseres, fiances i recàrregues, menys devolucions i anul·lacions en efectiu).

Si des del backoffice s’anul·la una recàrrega en efectiu mentre el seu torn és obert, l’anul·lació compta en aquell torn (els diners surten del mateix calaix). Si el torn ja s’ha tancat, l’anul·lació surt a la fila *Backoffice* del resum per jornada.

Al backoffice, a la pestanya **Caixa**:
- **Torns:** taquiller, terminal, hores, fons, efectiu, targeta, esperat, comptat i diferència.
- **Per terminal i jornada:** efectiu, targeta i vendes netes de cada aparell. Una jornada va de les 6:00 a les 6:00 de l’endemà, perquè una nit de festa compti com un sol dia.

## Saldo sobrant

El saldo que no es gasta es queda a la polsera. Es pot fer servir en el següent esdeveniment de la **mateixa entitat**, després d’activar-hi la polsera.

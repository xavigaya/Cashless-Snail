# Marca

Logo **concepte A, «Closca sense contacte»**: un cargol amb la closca feta d’ones de pagament sense contacte. El disseny original és al llenç de disseny «Logo Cashless Snail».

| Fitxer | Ús |
| --- | --- |
| `simbol.svg` | Símbol sobre fons clar |
| `simbol-insignia.svg` | Insígnia (fons llima, closca blanca) per a fons foscos, el favicon i la capçalera de l’app |
| `render-brand.cjs` | Genera els PNG de l’app (`apps/tpv/assets`) i del backoffice a partir dels SVG |

Colors:
- Verd molt fosc: `#0F2A22` (text i fons de la barra superior)
- Llima: `#C8F03C` (accent)
- Gris verdós: `#4A5D55` (text secundari)
- Fons clar: `#F1F4EE`

Tipografia: **Space Grotesk** (Google Fonts).

Per regenerar les icones, un cop instal·lat Playwright:

```bash
node docs/marca/render-brand.cjs docs/marca <carpeta de sortida>
```

Després cal copiar els PNG a `apps/tpv/assets` i executar `npx expo prebuild --platform android` per actualitzar les icones de l’app.

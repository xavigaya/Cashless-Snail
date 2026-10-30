// Renderitza els PNG de la marca a partir dels SVG (icona de l'app, logo de capçalera).
const { chromium } = require('playwright');
const fs = require('fs');
const [dir, out] = process.argv.slice(2);
const symbol = fs.readFileSync(`${dir}/simbol.svg`, 'utf8');
const badge = fs.readFileSync(`${dir}/simbol-insignia.svg`, 'utf8');
const strip = (svg) => svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"');
const jobs = [
  // Icona: fons llima a tota la superfície (Android i iOS hi apliquen la seva màscara).
  { file: 'icon.png', size: 1024, bg: '#C8F03C', inner: strip(symbol), pad: 0.18 },
  // Icona adaptativa d'Android: només el símbol, dins la zona segura (66 %).
  { file: 'adaptive-icon.png', size: 1024, bg: 'transparent', inner: strip(symbol), pad: 0.25 },
  { file: 'splash-icon.png', size: 512, bg: 'transparent', inner: strip(symbol), pad: 0.06 },
  { file: 'logo-insignia.png', size: 192, bg: 'transparent', inner: strip(badge), pad: 0 },
  { file: 'favicon-192.png', size: 192, bg: 'transparent', inner: strip(badge), pad: 0 },
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const j of jobs) {
    await p.setViewportSize({ width: j.size, height: j.size });
    const pad = Math.round(j.size * j.pad);
    await p.setContent(`<html><body style="margin:0;background:${j.bg}"><div style="width:${j.size}px;height:${j.size}px;box-sizing:border-box;padding:${pad}px;display:flex;align-items:center;justify-content:center">${j.inner}</div></body></html>`);
    await p.screenshot({ path: `${out}/${j.file}`, omitBackground: j.bg === 'transparent' });
  }
  await b.close();
})();

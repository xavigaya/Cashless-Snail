// Empaqueta l'API per a Supabase Edge Functions (Deno).
//
// - El codi del projecte, el paquet compartit i les dependències en JavaScript pur
//   (Hono, Drizzle, Zod) van dins d'un sol fitxer, només amb el codi que es fa servir.
// - El controlador de PostgreSQL (postgres-js), que necessita els mòduls de xarxa de Node,
//   no s'hi inclou: es reescriu a "npm:postgres@versió" i Supabase el descarrega en desplegar.
//   La versió surt de la instal·lada, perquè sigui la mateixa que s'ha provat.
//
// Ús: pnpm --filter @cashless/api build:edge
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const repoRoot = join(apiRoot, '..', '..');
const outfile = join(repoRoot, 'supabase', 'functions', 'api', 'api.js');
const requireFromApi = createRequire(join(apiRoot, 'package.json'));

/** "drizzle-orm/postgres-js" -> { name: "drizzle-orm", subpath: "/postgres-js" } */
function splitSpecifier(spec) {
  const parts = spec.split('/');
  const nameLength = spec.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, nameLength).join('/'), subpath: parts.slice(nameLength).join('/') };
}

function installedVersion(name) {
  // Algunes dependències no exporten package.json: es busca a partir del punt d'entrada.
  let dir = dirname(requireFromApi.resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === name) return pkg.version;
    } catch {
      // continua pujant
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No es troba la versió instal·lada de ${name}`);
    dir = parent;
  }
}

/** Paquets que no s'inclouen al fitxer i es carreguen de npm en temps d'execució. */
const EXTERNAL_PACKAGES = new Set(['postgres']);

const npmSpecifiers = {
  name: 'npm-specifiers',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:') || args.path.startsWith('npm:')) return { path: args.path, external: true };
      const { name, subpath } = splitSpecifier(args.path);
      if (!EXTERNAL_PACKAGES.has(name)) return undefined; // s'inclou al fitxer
      const version = installedVersion(name);
      return { path: `npm:${name}@${version}${subpath ? `/${subpath}` : ''}`, external: true };
    });
  },
};

mkdirSync(dirname(outfile), { recursive: true });
const result = await build({
  entryPoints: [join(apiRoot, 'src', 'edge.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  mainFields: ['module', 'main'],
  conditions: ['import', 'default'],
  treeShaking: true,
  legalComments: 'none',
  alias: { '@cashless/shared': join(repoRoot, 'packages', 'shared', 'src', 'index.ts') },
  plugins: [npmSpecifiers],
  banner: { js: '// Fitxer generat per apps/api/scripts/build-edge.mjs. No l\'editis a mà.' },
  metafile: true,
  logLevel: 'warning',
});

const externals = new Set(
  Object.values(result.metafile.outputs)
    .flatMap((o) => o.imports)
    .filter((i) => i.external && i.path.startsWith('npm:'))
    .map((i) => i.path),
);
console.log(`Edge Function generada: ${outfile}`);
console.log(`Dependències: ${[...externals].sort().join(', ')}`);

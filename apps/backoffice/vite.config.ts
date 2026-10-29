import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Ruta base on es publica: "/" en local; "/<repositori>/" a GitHub Pages.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    // Es fa servir el codi font del paquet compartit directament (sense compilar-lo abans).
    alias: {
      '@cashless/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173 },
});

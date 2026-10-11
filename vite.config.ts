import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Renomme dist/index.html en dist/PARALLAX.html après la construction.
function renameOutput(): Plugin {
  return {
    name: 'parallax-rename-output',
    apply: 'build',
    closeBundle() {
      const from = resolve(import.meta.dirname, 'dist/index.html');
      const to = resolve(import.meta.dirname, 'dist/PARALLAX.html');
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), renameOutput()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
});

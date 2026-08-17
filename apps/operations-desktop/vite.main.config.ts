import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: 'node24',
    outDir: path.resolve(root, 'dist/main'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(root, 'src/main/index.ts'),
      external: (id) => id === 'electron' || id.startsWith('node:'),
      output: {
        format: 'cjs',
        entryFileNames: 'index.js',
        inlineDynamicImports: true,
      },
    },
  },
});

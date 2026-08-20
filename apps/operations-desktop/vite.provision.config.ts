import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    target: 'node20',
    outDir: path.resolve(root, 'dist/tools'),
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(root, 'src/main/devProvision.ts'),
      external: (id) => id.startsWith('node:'),
      output: {
        format: 'cjs',
        entryFileNames: 'devProvision.js',
        inlineDynamicImports: true,
      },
    },
  },
});

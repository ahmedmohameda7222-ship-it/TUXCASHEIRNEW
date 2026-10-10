import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';

// Bundle the real production orders dispatcher and every reachable module,
// including dynamic resource imports. A missing runtime workspace package or
// invalid ESM import fails build/import instead of producing a false green.
const outDir = await mkdtemp(path.join(process.cwd(), '.admin-runtime-smoke-'));
try {
  await build({
    configFile: false,
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'error',
    ssr: {
      noExternal: ['@tux/domain'],
    },
    build: {
      ssr: 'apps/admin/api/admin/orders.ts',
      outDir,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          entryFileNames: 'orders.mjs',
          chunkFileNames: '[name]-[hash].mjs',
        },
      },
    },
  });
  const { default: handler } = await import(pathToFileURL(path.join(outDir, 'orders.mjs')).href);
  assert.equal(typeof handler, 'function', 'orders entrypoint must export a callable handler');

  // Exercise the compiled consolidated dispatcher through its HTTP entrypoint.
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      this[name] = value;
      return this;
    },
    end(body) {
      this.body = body;
      return this;
    },
  };
  await handler({ method: 'OPTIONS', url: '/api/admin/orders', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.allow, 'GET, POST');

  console.log('Admin compiled production dispatcher import smoke passed.');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectCatalogArchitectureViolations } from './catalog-architecture-guard.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tux-catalog-guard-'));
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  return root;
}

const valid = {
  'packages/catalog-contracts/package.json': JSON.stringify({ name: '@tux/catalog-contracts' }),
  'packages/catalog-contracts/src/index.ts': "export interface Product { readonly priceMinor: number }\n",
  'apps/menu/src/context/MenuContext.tsx': "const value = client.from('products').select('*');\n",
  'apps/menu/src/pages/Admin.tsx': "client.from('products').update({ active: false });\n",
  'apps/admin/server/env.ts': "const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];\n",
  'apps/menu/legacy/supabase_setup.sql.reference': '-- reference only',
  'supabase/migrations/001.sql': '-- canonical root migration',
  'supabase/functions/catalog-public/index.ts': "const key = Deno.env.get('SUPABASE_ANON_KEY');\n",
  'supabase/functions/catalog-admin/index.ts': "const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');\n",
};

test('accepts the canonical Phase B dependency/security shape and trusted Admin server boundary', async () => {
  const root = await fixture(valid);
  try {
    assert.deepEqual(await collectCatalogArchitectureViolations(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects Operations coupling, browser service-role access, persistence-shaped transport contracts, and second migration authority', async () => {
  const root = await fixture({
    ...valid,
    'packages/catalog-contracts/src/index.ts':
      "import '@tux/operations'; export interface Row { price_minor: number }\n",
    'apps/menu/src/newClient.ts':
      "import '@tux/operations';\nclient.from('products').update({ active: false });\n",
    'apps/admin/src/leak.ts': "const key = 'SUPABASE_SERVICE_ROLE_KEY';\n",
    'supabase/functions/catalog-public/index.ts': "Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');\n",
    'apps/menu/supabase/migrations/001.sql': '-- forbidden',
  });
  try {
    const violations = await collectCatalogArchitectureViolations(root);
    assert.equal(violations.some((value) => value.includes('transport contract')), true);
    assert.equal(violations.some((value) => value.includes('Operations implementation')), true);
    assert.equal(
      violations.some((value) => value.includes('service-role') && value.includes('apps/admin/src/leak.ts')),
      true,
    );
    assert.equal(
      violations.some((value) => value.includes('direct browser catalog mutation')),
      true,
    );
    assert.equal(
      violations.some((value) => value.includes('second executable Supabase migration authority')),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects direct Menu mutation of canonical order authority', async () => {
  const root = await fixture({
    ...valid,
    'apps/menu/src/orderBypass.ts':
      "await client.from('online_order_requests').insert({ status: 'ACCEPTED' });\nawait client.from('orders').upsert({ source: 'ONLINE' });\n",
  });
  try {
    const violations = await collectCatalogArchitectureViolations(root);
    assert.equal(
      violations.some((value) => value.includes('direct browser order-authority mutation from Menu')),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects reactivated legacy executable SQL', async () => {
  const root = await fixture({
    ...valid,
    'apps/menu/supabase_setup.sql': '-- executable legacy authority',
  });
  try {
    const violations = await collectCatalogArchitectureViolations(root);
    assert.equal(
      violations.some((value) => value.includes('legacy executable catalog SQL returned')),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

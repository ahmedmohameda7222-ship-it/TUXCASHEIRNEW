import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectArchitectureViolations } from './monorepo-architecture-guard.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tux-monorepo-guard-'));
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  return root;
}

const validRoot = {
  'package.json': JSON.stringify({
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      build: 'npm run build --workspaces --if-present',
      typecheck: 'npm run typecheck --workspaces --if-present',
      'test:e2e:menu': 'playwright test --config playwright.menu.config.ts',
      'test:monorepo-architecture': 'node scripts/test-monorepo-architecture.mjs',
    },
  }),
  'package-lock.json': '{}',
  'apps/menu/package.json': JSON.stringify({ name: '@tux/menu' }),
  'apps/operations/package.json': JSON.stringify({ name: '@tux/operations' }),
  'apps/menu/src/a.ts': "import '@tux/domain';\n",
  'supabase/migrations/001.sql': '-- canonical',
  '.github/workflows/ci.yml': [
    'npm run typecheck:menu',
    'npm run build:menu',
    'npm run test:e2e:menu',
    'npm run test:monorepo-architecture',
  ].join('\n'),
};

test('accepts canonical current-tree structure', async () => {
  const root = await fixture(validRoot);
  try {
    assert.deepEqual(await collectArchitectureViolations(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects relative and package-name cross-app imports', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/src/a.ts': "import '../../operations/src/main';\nimport '@tux/operations';\n",
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.filter((value) => value.includes('cross-app import')).length >= 2, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects nested lock, legacy SQL, and second migration authority', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/package-lock.json': '{}',
    'apps/menu/supabase_setup.sql': '-- legacy',
    'apps/menu/supabase/migrations/001.sql': '-- second',
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.some((value) => value.includes('nested package-lock')), true);
    assert.equal(violations.some((value) => value.includes('legacy executable SQL')), true);
    assert.equal(violations.some((value) => value.includes('second Supabase migration authority')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects wrong Menu identity and missing permanent CI coverage', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/package.json': JSON.stringify({ name: 'tux-burger-website' }),
    '.github/workflows/ci.yml': 'npm run build\n',
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.some((value) => value.includes('@tux/menu')), true);
    assert.equal(violations.some((value) => value.includes('CI coverage')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

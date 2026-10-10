import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const probePath = 'apps/admin/server/runtimeWorkspaceGuardProbe.ts';
const configPath = 'apps/admin/vercel.json';
const originalVercel = fs.readFileSync(configPath, 'utf8');
assert.equal(fs.existsSync(probePath), false, 'Runtime contract probe path must be unused');

function checkContract(shouldSucceed, expectedFailure = '') {
  const result = spawnSync('node', ['scripts/test-admin-deployment-contract.mjs'], {
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  if (shouldSucceed) {
    assert.equal(result.status, 0, `Expected accepted runtime import contract: ${output}`);
  } else {
    assert.notEqual(result.status, 0, 'Invalid runtime import contract was accepted');
    assert.ok(output.includes(expectedFailure), `Wrong runtime guard failure: ${output}`);
  }
}

try {
  fs.writeFileSync(probePath, "import { missing } from '@tux/undeclared-runtime';\n");
  checkContract(false, 'Undeclared Admin runtime workspace dependency');

  fs.writeFileSync(probePath, "import type { SafeType } from '@tux/undeclared-runtime';\n");
  checkContract(true);

  // Named import with only type specifiers still emits a side-effect import.
  // Unlike `import type`, it requires the runtime package and must be rejected.
  fs.writeFileSync(probePath, "import { type SafeType } from '@tux/undeclared-runtime';\n");
  checkContract(false, 'Undeclared Admin runtime workspace dependency');

  fs.writeFileSync(probePath, "void import('@tux/undeclared-runtime');\n");
  checkContract(false, 'Undeclared Admin runtime workspace dependency');

  fs.rmSync(probePath);
  const config = JSON.parse(originalVercel);
  config.functions['api/**/*.ts'].includeFiles = '../../packages/irrelevant/**';
  fs.writeFileSync(configPath, JSON.stringify(config));
  checkContract(false, 'Missing Admin Vercel runtime source packaging');

  delete config.functions;
  fs.writeFileSync(configPath, JSON.stringify(config));
  checkContract(false, 'Admin Vercel functions includeFiles must be a single glob string');
} finally {
  if (fs.existsSync(probePath)) fs.rmSync(probePath);
  fs.writeFileSync(configPath, originalVercel);
}
checkContract(true);
console.log('Runtime workspace import and source inclusion negative regressions passed.');

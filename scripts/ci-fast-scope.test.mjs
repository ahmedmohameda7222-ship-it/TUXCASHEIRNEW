import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFiles } from './ci-fast-scope.mjs';

test('docs-only changes avoid all application test jobs', () => {
  const scope = classifyFiles(['docs/README.md']);
  assert.deepEqual(Object.values(scope).filter(Boolean), []);
});

test('Admin UI change does not request Windows, migrations or Menu typechecks', () => {
  const scope = classifyFiles(['apps/admin/src/orders/OrdersPage.tsx']);
  assert.equal(scope.static, true);
  assert.equal(scope.unit, true);
  assert.equal(scope.types, true);
  assert.equal(scope.admin, true);
  assert.equal(scope.menu, false);
  assert.equal(scope.desktop, false);
  assert.equal(scope.migration, false);
});

test('shared sync code causes cross-workspace safety checks', () => {
  const scope = classifyFiles(['packages/sync/src/outboxSync.ts']);
  assert.equal(scope.shared, true);
  assert.equal(scope.operations, true);
  assert.equal(scope.unit, true);
  assert.equal(scope.types, true);
});

test('database migrations run only the migration job', () => {
  const scope = classifyFiles(['supabase/migrations/20261023120000_fix.sql']);
  assert.equal(scope.migration, true);
  assert.equal(scope.unit, false);
  assert.equal(scope.types, false);
});

test('Supabase function updates trigger Edge checking', () => {
  const scope = classifyFiles(['supabase/functions/operations-sync/index.ts']);
  assert.equal(scope.edge, true);
  assert.equal(scope.unit, false);
});

test('E2E TypeScript changes must typecheck even without app changes', () => {
  const scope = classifyFiles(['e2e/operations-branch-login.e2e.ts']);
  assert.equal(scope.types, true);
  assert.equal(scope.unit, false);
});

test('Admin order and shared sync changes are both in scope', () => {
  const scope = classifyFiles([
    'apps/admin/src/orders/useOrders.ts',
    'packages/sync/src/outboxSync.ts',
  ]);
  assert.equal(scope.admin, true);
  assert.equal(scope.operations, true);
  assert.equal(scope.shared, true);
});

test('Deleting historical screenshots leaves runtime jobs disabled', () => {
  const scope = classifyFiles(['artifacts/tux-final/matrix/alerts.png']);
  assert.deepEqual(Object.values(scope).filter(Boolean), []);
});

test('Node test and CI helper files never masquerade as Vitest suites', () => {
  const scope = classifyFiles(['scripts/ci-fast-scope.test.mjs']);
  assert.equal(scope.unit, false);
});

test('Runtime changes select the Vitest unit job', () => {
  const scope = classifyFiles(['apps/operations/src/app/automaticSync.ts']);
  assert.equal(scope.unit, true);
});

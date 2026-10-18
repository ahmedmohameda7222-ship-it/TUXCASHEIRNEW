// Canonical CSS ownership regression: run with node scripts/test-admin-ui-css-ownership.mjs.
// A lazy-loaded feature stylesheet must never be the only owner of cross-route components.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('apps/admin/src');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const shared = read('components/ui/primitives.css');
const main = read('main.tsx');

assert.match(main, /import ['"]\.\/components\/ui\/primitives\.css['"]/, 'Shared CSS must load at Admin boot');
for (const selector of ['admin-secondary-button', 'admin-field', 'admin-field__help', 'admin-record-row', 'admin-record-list', 'admin-form-section']) {
  assert.ok(shared.includes('.' + selector), selector + ' must be styled by shared UI');
}
for (const [owner, regex] of [
  ['catalog/catalog.css', /\.admin-(?:secondary-button|field(?:__help)?)\b/],
  ['settings/settings.css', /\.admin-record-row\b/],
  ['inventory/inventory.css', /\.admin-record-list\b/],
]) {
  assert.doesNotMatch(read(owner), regex, owner + ' must not duplicate shared CSS ownership');
}
for (const [foreign, forbidden] of [
  ['approvals/ApprovalRulesPage.tsx', /admin-(?:settings-row|catalog-editor__section)\b/],
  ['settings/SettingsPage.tsx', /admin-catalog-editor__section\b/],
  ['staff/StaffPage.tsx', /admin-inventory-(?:list|row|page-actions)\b/],
  ['purchasing/SuppliersPage.tsx', /admin-(?:catalog-editor__|inventory-)/],
  ['purchasing/PurchaseOrdersPage.tsx', /admin-(?:catalog-editor__|inventory-)/],
]) {
  assert.doesNotMatch(read(foreign), forbidden, foreign + ' depends on an unrelated lazy stylesheet');
}
for (const route of ['ExpensesPage', 'SettlementsPage', 'EndDayPage']) {
  assert.match(read('finance/' + route + '.tsx'), /import ['"]\.\/finance\.css['"]/, route + ' must load its finance style boundary when deep-linked');
}
console.log('Admin CSS ownership and direct-route import guard passed.');

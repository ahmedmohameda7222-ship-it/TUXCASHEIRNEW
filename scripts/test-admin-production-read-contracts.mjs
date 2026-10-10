import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const path of [
  'apps/admin/server/staff/staffStore.ts',
  'apps/admin/server/delivery/deliveryApi.ts',
]) {
  const source = readFileSync(path, 'utf8');
  const shopQueries = [...source.matchAll(
    /['"]shops['"],\s*new URLSearchParams\(\{([\s\S]*?)\}\)/g,
  )];
  assert.ok(shopQueries.length > 0, `Expected actual shops read query in ${path}`);
  for (const match of shopQueries) {
    assert.doesNotMatch(match[1], /\bbusiness_id\s*:/, `Invalid shops.business_id filter: ${path}`);
  }
}
for (const path of [
  'apps/admin/api/admin/orders.ts',
  'apps/admin/server/delivery/deliveryApi.ts',
]) {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /\bdisplay_order_label\b/, `Stale orders read column in ${path}`);
}
console.log('Admin production read-column contract source scan passed.');

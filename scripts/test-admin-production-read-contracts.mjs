import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const path of [
  'apps/admin/server/staff/staffStore.ts',
  'apps/admin/server/delivery/deliveryApi.ts',
]) {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(
    source,
    /['"]shops['"],\s*new URLSearchParams\(\{[\s\S]*?business_id:/,
    `Invalid shops.business_id filter in ${path}`,
  );
}
for (const path of [
  'apps/admin/api/admin/orders.ts',
  'apps/admin/server/delivery/deliveryApi.ts',
]) {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /\bdisplay_order_label\b/, `Stale orders read column in ${path}`);
}
console.log('Admin production read-column contract source scan passed.');

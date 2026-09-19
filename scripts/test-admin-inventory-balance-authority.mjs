import fs from 'node:fs';

const api = fs.readFileSync('apps/admin/api/admin/inventory.ts', 'utf8');

if (api.includes("limit: '2000'") && api.includes("'inventory_movements'")) {
  throw new Error('Admin current balances must not be derived from a truncated movement history page');
}
if (!api.includes('read_admin_inventory_balances_v1')) {
  throw new Error('Admin inventory workspace must read current balances from a canonical server-side projection');
}

console.log('Admin inventory full-ledger balance authority invariant passed.');

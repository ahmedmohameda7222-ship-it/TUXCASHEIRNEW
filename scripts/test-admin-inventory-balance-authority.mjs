import fs from 'node:fs';

const api = fs.readFileSync('apps/admin/api/admin/inventory.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260910130000_admin_inventory_ledger.sql',
  'utf8',
);

if (!migration.includes('create or replace function public.read_admin_inventory_balances_v1')) {
  throw new Error('canonical full-ledger balance RPC is missing');
}
if (
  !api.includes('export async function loadInventoryBalanceRows') ||
  !api.includes("'read_admin_inventory_balances_v1'")
) {
  throw new Error('Admin inventory workspace must read current balances from the canonical RPC');
}
if (!api.includes('const balances = new Map(') || !api.includes('const balance = balances.get(row.id)')) {
  throw new Error('Admin inventory item balances must come from the canonical balance projection');
}
if (!api.includes("limit: '2000'")) {
  throw new Error('Admin inventory history should remain separately bounded from current balances');
}

console.log('Admin inventory full-ledger balance authority invariant passed.');

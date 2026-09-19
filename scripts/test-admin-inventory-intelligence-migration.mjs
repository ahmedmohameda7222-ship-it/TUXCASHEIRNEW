import fs from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260910140000_admin_inventory_intelligence.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const name of [
  'inventory_replenishment_settings',
  'inventory_margin_settings',
  'par_level_base',
  'reorder_point_base',
  'preferred_supplier_id',
  'preferred_purchase_unit',
  'lead_time_days',
  'minimum_order_quantity_base',
  'order_multiple_base',
  'target_food_cost_percent',
  'alert_food_cost_percent',
]) {
  if (!sql.includes(name)) throw new Error(`missing inventory intelligence contract: ${name}`);
}

if (!sql.includes('enable row level security')) {
  throw new Error('inventory intelligence tables must enable RLS');
}
if (!sql.includes('revoke all on public.inventory_replenishment_settings from public, anon, authenticated')) {
  throw new Error('browser roles must not access replenishment settings directly');
}
if (!sql.includes('revoke all on public.inventory_margin_settings from public, anon, authenticated')) {
  throw new Error('browser roles must not access margin settings directly');
}
if (!sql.includes('grant select, insert, update, delete on public.inventory_replenishment_settings to service_role')) {
  throw new Error('service_role must own the replenishment settings boundary');
}
if (/references\s+public\.suppliers\b/.test(sql)) {
  throw new Error('Task 4 must not create a supplier FK before Task 5 supplier authority exists');
}

console.log('Admin inventory intelligence migration invariant passed.');

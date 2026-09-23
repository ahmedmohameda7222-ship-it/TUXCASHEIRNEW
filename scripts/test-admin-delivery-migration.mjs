import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260910190000_admin_delivery.sql',
  import.meta.url,
);

assert.equal(fs.existsSync(migrationPath), true, 'Plan 5 delivery migration must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredPatterns = [
  [/alter table public\.delivery_zones/i, 'extension of canonical delivery zones'],
  [/boundary_json/i, 'geographic delivery boundary'],
  [/priority/i, 'zone priority'],
  [/minimum_order_minor/i, 'authoritative minimum order'],
  [/fallback_shop_id/i, 'explicit fallback shop'],
  [/fallback_enabled/i, 'explicit fallback enablement'],
  [/create table if not exists public\.delivery_riders/i, 'shop-scoped rider records'],
  [/create table if not exists public\.delivery_order_states/i, 'delivery order state projection'],
  [/create table if not exists public\.delivery_order_state_events/i, 'append-only delivery state history'],
  [/UNASSIGNED[\s\S]*ASSIGNED[\s\S]*OUT_FOR_DELIVERY[\s\S]*DELIVERED[\s\S]*FAILED[\s\S]*RETURNED/i, 'approved delivery lifecycle'],
  [/create or replace function public\.transition_admin_delivery_order_v1/i, 'trusted rider transition RPC'],
  [/delivery\.manage/i, 'delivery permission authority'],
  [/for update/i, 'transactional delivery transition locking'],
  [/unique\s*\(business_id,\s*command_id\)/i, 'durable transition idempotency'],
  [/revoke all on function public\.transition_admin_delivery_order_v1/i, 'browser transition RPC denial'],
  [/grant execute on function public\.transition_admin_delivery_order_v1/i, 'trusted transition grant'],
];

for (const [pattern, label] of requiredPatterns) {
  assert.match(sql, pattern, `Delivery migration is missing ${label}`);
}

assert.doesNotMatch(
  sql,
  /delete\s+from\s+public\.delivery_order_state_events/i,
  'Delivery state history must be append-only',
);

console.log('Admin Plan 5 delivery migration source invariants passed.');

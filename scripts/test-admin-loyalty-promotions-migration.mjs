import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260910180000_admin_loyalty_promotions.sql',
  import.meta.url,
);

assert.equal(fs.existsSync(migrationPath), true, 'Plan 5 loyalty/promotions migration must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredPatterns = [
  [/create table public\.loyalty_ledger/i, 'immutable loyalty ledger'],
  [/create table public\.promotion_rules/i, 'canonical promotion rules'],
  [/\bPERCENT\b[\s\S]*\bFIXED\b[\s\S]*\bFREE_ITEM\b/i, 'approved promotion kinds'],
  [/total_usage_limit/i, 'global promotion usage limits'],
  [/per_customer_usage_limit/i, 'per-customer promotion usage limits'],
  [/minimum_redemption/i, 'minimum loyalty redemption policy'],
  [/point_expir/i, 'explicit point expiry policy/events'],
  [/create table public\.reward_reservations/i, 'online scarce-reward reservations'],
  [/checkout_intent/i, 'stable checkout/order-intent idempotency key'],
  [/expires_at/i, 'bounded reservation expiry'],
  [/create or replace function public\.reserve_order_rewards_v1/i, 'atomic reward reservation RPC'],
  [/create or replace function public\.consume_order_reward_reservation_v1/i, 'single-consumption finalization RPC'],
  [/create or replace function public\.release_order_reward_reservation_v1/i, 'safe reservation release RPC'],
  [/for update/i, 'canonical reward-state row locking'],
  [/applied_reward_snapshot/i, 'immutable applied reward snapshot'],
  [/revoke all on function public\.reserve_order_rewards_v1/i, 'browser reward reservation denial'],
  [/grant execute on function public\.reserve_order_rewards_v1/i, 'trusted reward reservation grant'],
];

for (const [pattern, label] of requiredPatterns) {
  assert.match(sql, pattern, `Loyalty/promotions migration is missing ${label}`);
}

assert.doesNotMatch(
  sql,
  /update\s+public\.loyalty_ledger/i,
  'Loyalty history must be append-only; corrections use compensating events',
);

console.log('Admin Plan 5 loyalty/promotions migration source invariants passed.');

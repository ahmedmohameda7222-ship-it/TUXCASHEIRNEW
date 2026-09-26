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
  [
    /perform\s+private\.expire_customer_loyalty_points_for_customer_v1\(/i,
    'reservation-time loyalty expiry materialization',
  ],
  [
    /create or replace function private\.post_order_loyalty_earn_v1/i,
    'idempotent canonical order loyalty earning',
  ],
  [
    /create trigger orders_post_loyalty_earn[\s\S]*post_inserted_order_loyalty_earn_v1/i,
    'ordinary order loyalty earn trigger',
  ],
  [/order-loyalty-earn:/i, 'stable order loyalty earn idempotency key'],
  [/create or replace function public\.consume_order_reward_reservation_v1/i, 'single-consumption finalization RPC'],
  [/create or replace function public\.release_order_reward_reservation_v1/i, 'safe reservation release RPC'],
  [/for update/i, 'canonical reward-state row locking'],
  [/applied_reward_snapshot/i, 'immutable applied reward snapshot'],
  [/alter table public\.online_order_requests[\s\S]*promotion_id/i, 'ONLINE promotion intent persistence'],
  [/alter table public\.online_order_requests[\s\S]*loyalty_points_to_redeem/i, 'ONLINE loyalty intent persistence'],
  [/'promotionId'[\s\S]*request\.promotion_id/i, 'ONLINE inbox promotion intent projection'],
  [/'loyaltyPointsToRedeem'[\s\S]*request\.loyalty_points_to_redeem/i, 'ONLINE inbox loyalty intent projection'],
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

assert.doesNotMatch(
  sql,
  /reward-reservation:[^\n]*:earn/i,
  'Reward consumption must reuse the canonical order earn path instead of double-crediting',
);

console.log('Admin Plan 5 loyalty/promotions migration source invariants passed.');

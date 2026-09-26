import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260910160000_admin_order_controls.sql',
  import.meta.url,
);

assert.equal(
  fs.existsSync(migrationPath),
  true,
  'Plan 5 order-controls migration must exist',
);

const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredPatterns = [
  [/create table public\.admin_order_refunds/i, 'immutable refund events'],
  [/create table public\.admin_order_return_items/i, 'immutable returned-item events'],
  [/create table public\.order_lifecycle_feed/i, 'monotonic lifecycle feed'],
  [/generated always as identity/i, 'monotonic lifecycle sequence'],
  [/create or replace function public\.cancel_admin_order_v1/i, 'trusted Admin cancellation RPC'],
  [/p_expected_operational_revision/i, 'compare-and-swap expected revision'],
  [/for update/i, 'row lock before lifecycle transition'],
  [/TUX_ORDER_STALE_OPERATIONAL_REVISION/i, 'stable stale-revision rejection'],
  [/CANCELLATION/i, 'structured cancellation reason family validation'],
  [/REFUND_RETURN/i, 'structured refund/return reason family validation'],
  [/reason_label_snapshot/i, 'immutable reason label snapshot'],
  [/operational_revision\s*=\s*operational_revision\s*\+\s*1/i, 'single canonical revision increment'],
  [/ORDER_RESERVATION_RELEASE/i, 'reservation release within cancellation authority'],
  [/enable row level security/i, 'RLS on Plan 5 business tables'],
  [/revoke all on function public\.cancel_admin_order_v1/i, 'browser RPC denial'],
  [/grant execute on function public\.cancel_admin_order_v1/i, 'service-role cancellation grant'],
];

for (const [pattern, label] of requiredPatterns) {
  assert.match(sql, pattern, `Order-controls migration is missing ${label}`);
}

const directOrderRewrite = /update\s+public\.orders[\s\S]{0,500}status\s*=\s*'CANCELLED'/i;
assert.match(sql, directOrderRewrite, 'Cancellation RPC must own the canonical order transition');
assert.match(
  sql,
  /insert into public\.order_status_events/i,
  'Cancellation must append canonical lifecycle history',
);
assert.match(
  sql,
  /insert into public\.order_lifecycle_feed/i,
  'Cancellation must publish the same canonical lifecycle change to the proactive feed',
);

console.log('Admin Plan 5 order-controls migration source invariants passed.');

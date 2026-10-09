import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261008060000_admin_plan7_payment_materialization.sql', import.meta.url),
  'utf8',
);

for (const [pattern, description] of [
  [/after insert on public\.payments/i, 'trusted payment insertion boundary'],
  [/after insert or update of state on public\.admin_order_refunds/i, 'posted refund state boundary'],
  [/new\.allocated_minor/i, 'allocated amount (not tendered amount)'],
  [/new\.state\s*<>\s*'POSTED'/i, 'posted-only refund'],
  [/new\.payment_id/i, 'refund references original payment'],
  [/source_kind\s*=\s*'PAYMENT'/i, 'historical payment movement attribution'],
  [/new\.created_at\s*>=\s*m\.updated_at/i, 'no retroactive mapping'],
  [/m\.active/i, 'mapping must be explicitly active'],
  [/actor_worker_id/i, 'real Operations worker provenance'],
  [/actor_employee_id/i, 'real Admin refund actor provenance'],
  [/on conflict[\s\S]*do nothing/i, 'source replay safety'],
  [/revoke all on function private\./i, 'browser trigger function EXECUTE revoked'],
]) {
  assert.match(sql, pattern, `Missing ${description}`);
}

assert.doesNotMatch(sql, /new\.received_minor/i, 'Do not use tendered amount as financial SALE');
assert.doesNotMatch(sql, /update\s+public\.business_days/i, 'Admin cannot close Business Day');
assert.doesNotMatch(sql, /insert\s+into\s+public\.finance_accounts/i, 'No invented finance accounts');
assert.doesNotMatch(sql, /insert\s+into\s+public\.payment_method_finance_accounts/i, 'No guessed method mappings');

console.log('Plan 7 trusted SALE/REFUND materialization source invariants passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260910195000_admin_finance_core.sql',
  import.meta.url,
);

assert.equal(fs.existsSync(migrationPath), true, 'Plan 6 finance-core migration must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredPatterns = [
  [/create table public\.finance_accounts/i, 'finance_accounts'],
  [/create table public\.finance_movements/i, 'finance_movements'],
  [/create table public\.payment_method_finance_accounts/i, 'payment-method mapping foundation'],
  [/create or replace function public\.post_finance_movement_v1/i, 'trusted posting RPC'],
  [/'STAFF_PAYMENT'/i, 'staff-payment movement vocabulary'],
  [/'OWNER_WITHDRAWAL'/i, 'future Plan 7 movement vocabulary'],
  [/source_kind/i, 'canonical source kind'],
  [/source_id/i, 'canonical source id'],
  [/source_effect/i, 'canonical source effect'],
  [/request_fingerprint/i, 'idempotency payload fingerprint'],
  [/unique[^\n]*business_id[^\n]*command_id/i, 'durable command uniqueness'],
  [/finance_movements_source/i, 'canonical source uniqueness'],
  [/positive[^\n]*inflow|inflow[^\n]*positive/i, 'signed amount convention'],
  [/enable row level security/i, 'RLS'],
  [/revoke all on public\.finance_accounts from public, anon, authenticated/i, 'finance account browser revoke'],
  [/revoke all on public\.finance_movements from public, anon, authenticated/i, 'finance movement browser revoke'],
  [/revoke all on public\.payment_method_finance_accounts from public, anon, authenticated/i, 'mapping browser revoke'],
  [/revoke all on function public\.post_finance_movement_v1/i, 'posting RPC browser denial'],
  [/grant execute on function public\.post_finance_movement_v1/i, 'posting RPC service-role grant'],
  [/employee_shop_assignments|resolve_admin_authorization_v1/i, 'employee/shop authority validation'],
  [/for update/i, 'account lock'],
];

for (const [pattern, label] of requiredPatterns) {
  assert.match(sql, pattern, `Finance-core migration is missing ${label}`);
}

for (const table of ['finance_accounts', 'finance_movements', 'payment_method_finance_accounts']) {
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `Finance-core migration is missing RLS for ${table}`,
  );
}

assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.finance_accounts\b/i,
  'Finance core must not seed fictional accounts or balances',
);
assert.doesNotMatch(
  sql,
  /insert\s+into\s+public\.payment_method_finance_accounts\b/i,
  'Finance core must not invent historical payment-method mappings',
);

console.log('Admin Plan 6 finance-core migration source invariants passed.');

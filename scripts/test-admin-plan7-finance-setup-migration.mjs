import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261008070000_admin_plan7_finance_setup.sql', import.meta.url),
  'utf8',
);
for (const [pattern, requirement] of [
  [/create table private\.finance_setup_commands/i, 'durable command identity'],
  [/create or replace function public\.create_finance_account_v1/i, 'account creation'],
  [/create or replace function public\.set_finance_account_active_v1/i, 'account deactivation'],
  [/create or replace function public\.set_payment_method_finance_account_v1/i, 'explicit account mapping'],
  [/'finance.manage_accounts'/i, 'manage accounts permission'],
  [/resolve_admin_authorization_v1/i, 'server-side authorization'],
  [/request_fingerprint/i, 'command fingerprint'],
  [/pg_advisory_xact_lock/i, 'serializable command idempotence'],
  [/finance_command_conflict/i, 'conflicting command replay'],
  [/expected_version/i, 'optimistic concurrency'],
  [/append_admin_audit_event_v1/i, 'Admin audit'],
  [/revoke all on function public\.create_finance_account_v1/i, 'browser denial'],
  [/revoke all on function public\.set_payment_method_finance_account_v1/i, 'browser denial'],
  [/grant execute on function public\.create_finance_account_v1/i, 'service-role execution'],
]) assert.match(sql, pattern, `Finance setup missing ${requirement}`);

assert.doesNotMatch(sql, /update\s+public\.finance_accounts\s+set\s+opening_balance_minor/i);
assert.doesNotMatch(sql, /delete\s+from\s+public\.finance_accounts/i);
assert.doesNotMatch(sql, /update\s+public\.business_days/i);
assert.doesNotMatch(sql, /insert\s+into\s+public\.payment_method_finance_accounts[\s\S]{0,1000}logic_type/i);

console.log('Plan 7 finance setup account/mapping permission invariants passed.');

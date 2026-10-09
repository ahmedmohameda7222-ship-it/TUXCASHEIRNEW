import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261008072000_admin_plan7_finance_workspace.sql', import.meta.url),
  'utf8',
);
for (const [pattern, description] of [
  [/create or replace function public\.finance_workspace_v1/i, 'workspace RPC'],
  [/'finance.view'/i, 'read permission'],
  [/resolve_admin_authorization_v1/i, 'server authorization'],
  [/finance_movements/i, 'canonical ledger'],
  [/opening_balance_minor/i, 'explicit opening balances'],
  [/payment_method_finance_accounts/i, 'explicit mappings'],
  [/account_type/i, 'account categories'],
  [/SETUP_REQUIRED/i, 'zero-state setup'],
  [/NEEDS_ATTENTION/i, 'unmapped attention'],
  [/revoke all on function public\.finance_workspace_v1/i, 'browser EXECUTE denial'],
  [/grant execute on function public\.finance_workspace_v1/i, 'service role grant'],
]) assert.match(sql, pattern, description);
assert.doesNotMatch(sql, /insert\s+into\s+public\.finance_accounts/i);
assert.doesNotMatch(sql, /update\s+public\.business_days/i);
console.log('Plan 7 Finance read workspace authorization/zero-state invariants passed.');

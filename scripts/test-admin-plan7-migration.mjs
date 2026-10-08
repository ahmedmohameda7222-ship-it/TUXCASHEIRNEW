import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = new URL(
  '../supabase/migrations/20261008053000_admin_plan7_finance_schema.sql',
  import.meta.url,
);
assert.equal(fs.existsSync(path), true, 'Plan 7 forward-only schema migration is required');

const sql = fs.readFileSync(path, 'utf8');
const requiredTables = [
  'payment_settlements',
  'expense_categories',
  'recurring_expense_rules',
  'end_day_financial_snapshots',
  'cashier_reconciliations',
  'financial_adjustments',
  'saved_report_views',
  'report_targets',
  'daily_owner_summaries',
];

for (const table of requiredTables) {
  assert.match(sql, new RegExp(`create table public\\.${table}\\b`, 'i'), `missing ${table}`);
  assert.match(
    sql,
    new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `missing default-deny RLS for ${table}`,
  );
  assert.match(
    sql,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'),
    `missing browser revocation for ${table}`,
  );
}

assert.match(sql, /alter table public\.expenses\s+alter column created_by_worker_id drop not null/i);
assert.match(sql, /add column created_by_employee_id uuid/i);
assert.match(sql, /expenses_creator_provenance_ck/i);
assert.match(sql, /alter table public\.finance_movements\s+alter column actor_employee_id drop not null/i);
assert.match(sql, /add column actor_worker_id uuid/i);
assert.match(sql, /finance_movements_actor_provenance_ck/i);
assert.match(sql, /foreign key \(shop_id, actor_worker_id\)/i);
assert.match(sql, /foreign key \(shop_id, business_day_id\)/i);
assert.match(sql, /foreign key \(business_id, shop_id\)/i);
assert.match(sql, /unique \(business_id, shop_id, business_day_id\)/i);
assert.match(sql, /prevent_plan7_immutable_fact_mutation/i);
assert.match(sql, /check \(gross_minor = net_minor \+ fee_minor\)/i);
assert.match(sql, /check \(fee_minor >= 0\)/i);
assert.match(sql, /report_views_business_employee_fkey/i);
assert.match(sql, /report_targets_business_shop_fkey/i);
assert.match(sql, /expense_categories_business_shop_fkey/i);
assert.match(sql, /daily_owner_summaries_business_shop_fkey/i);

for (const name of ['finance_accounts', 'finance_movements', 'payment_method_finance_accounts', 'expenses', 'business_days']) {
  assert.doesNotMatch(sql, new RegExp(`(?:create table|drop table|truncate) public\\.${name}\\b`, 'i'));
}
assert.doesNotMatch(sql, /insert\s+into\s+public\.(?:finance_accounts|payment_method_finance_accounts)/i);
assert.doesNotMatch(sql, /update\s+public\.business_days/i);
assert.doesNotMatch(sql, /create\s+table\s+public\.admin_expenses/i);

console.log('Plan 7 schema and provenance migration invariants passed.');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync('supabase/migrations/20261008134000_admin_plan7_report_coverage.sql','utf8');
for (const source of ['admin_order_returns','attendance_events','loyalty_ledger','promotion_usage_ledger','customer_segments']) {
  assert(sql.includes('public.'+source), 'missing canonical report source '+source);
}
assert.match(sql,/revoke all on function public\.admin_finance_report_query_v1/);
assert.match(sql,/grant execute on function public\.admin_finance_report_query_v1/);
const api=readFileSync('apps/admin/server/reports/reportApi.ts','utf8');
for (const area of ['loyalty','promotions','segments','attendance']) assert(api.includes("'"+area+"'"));
console.log('Plan 7 canonical additional report source and privileges invariant passed.');

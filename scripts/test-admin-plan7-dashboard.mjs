import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20261008136000_admin_plan7_dashboard_metrics.sql','utf8');
for (const table of [
  'orders','payments','admin_order_refunds','order_items','inventory_items',
  'inventory_movements','online_order_requests','admin_approval_requests',
  'attendance_events',
]) assert(sql.includes('public.'+table), 'home metric must use canonical '+table);
for (const key of ['netSalesMinor','averageOrderMinor','salesTrend','topProducts',
  'sourceMix','shopComparison','lowStockCount','failedOnlineOrderCount',
  'pendingApprovalCount','staffOnShiftCount','deliveryOpenCount']) {
  assert(sql.includes(key), 'missing Home KPI '+key);
}
assert.match(sql,/resolve_admin_authorization_v1/);
assert.match(sql,/revoke all on function public\.admin_plan7_dashboard_metrics_v1/);
assert.match(sql,/grant execute on function public\.admin_plan7_dashboard_metrics_v1/);
console.log('Plan 7 role-scoped sourced dashboard KPIs invariants passed.');

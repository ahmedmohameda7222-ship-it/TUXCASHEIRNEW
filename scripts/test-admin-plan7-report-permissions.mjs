import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const bff = read('apps/admin/server/reports/reportApi.ts');
const policy = read('apps/admin/server/reports/reportAuthorization.ts');
const migration = read('supabase/migrations/20261008139000_admin_plan7_report_domain_authorization.sql');
const dashboard = migration.slice(migration.indexOf('create or replace function public.admin_plan7_dashboard_metrics_v1('));

for (const [area, permission] of [
  ['profit', 'finance.view'],
  ['payments', 'finance.view'],
  ['expenses', 'finance.view'],
  ['bank-cash', 'finance.view'],
  ['staff', 'staff.view'],
  ['attendance', 'staff.view'],
  ['purchasing', 'purchasing.view'],
  ['delivery', 'delivery.view'],
  ['inventory-consumption', 'inventory.view'],
  ['customers', 'customers.view'],
  ['promotions', 'promotions.manage'],
]) {
  assert(policy.includes(`${area.includes('-') ? `'${area}'` : area}: '${permission}'`), `${area} must require ${permission}`);
  assert(migration.includes(`when '${area}' then '${permission}'`), `SQL ${area} policy absent`);
}
assert.match(bff, /requireReportArea\(principal, selectedArea, id\)/);
assert.match(bff, /sendJson\(response, 200, maskDashboardMetrics\(principal, result\)\)/);
assert.match(bff, /canReadReportFilterOption\(principal, key\)/);
assert.match(bff, /requireReportContextPermissions\(principal, context, id\)/);
assert.match(migration, /private\.plan7_report_required_permission_v1\(v_area\)/);
assert.match(migration, /private\.plan7_report_context_allowed_v1/);
assert.match(dashboard, /v_can_finance boolean/);
assert.match(dashboard, /v_can_inventory boolean/);
assert.match(dashboard, /v_can_staff boolean/);
assert.match(dashboard, /v_can_delivery boolean/);
assert.match(dashboard, /if v_can_finance then/);
assert.match(dashboard, /case when not v_can_inventory/);
assert.match(dashboard, /case when v_can_staff then/);
assert.match(dashboard, /case when v_can_delivery then/);
assert.match(dashboard, /exists\s*\(select 1 from public\.payments p/);
assert.match(dashboard, /and p\.allocated_minor>0/);
console.log('Plan 7 mixed-permission P0 and paid-product invariant checks pass');

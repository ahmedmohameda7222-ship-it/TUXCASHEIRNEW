import assert from 'node:assert/strict';
import fs from 'node:fs';

const config=JSON.parse(fs.readFileSync('apps/admin/vercel.json','utf8'));
const gateway=fs.readFileSync('apps/admin/api/admin/orders.ts','utf8');

for (const [path,resource,handler] of [
  ['/api/admin/finance','finance','handleFinanceRequest'],
  ['/api/admin/reports','reports','handleReportsRequest'],
]) {
  assert(config.routes.some((r)=>r.src===path&&r.dest===
    `/api/admin/orders?__adminResource=${resource}`),`missing gateway route: ${path}`);
  assert(gateway.includes(handler),`gateway must dispatch ${handler}`);
}
for (const path of [
  'apps/admin/api/admin/finance.ts',
  'apps/admin/api/admin/reports.ts',
]) assert.equal(fs.existsSync(path),false,`no standalone serverless entrypoint: ${path}`);
const financeApi=fs.readFileSync('apps/admin/server/finance/financeApi.ts','utf8');
assert.match(financeApi,/account\.shop_id === null && role !== 'OWNER'/,
  'business-wide account history must require elevated authority');
assert.match(financeApi,/if \(account\.shop_id !== null\) movementQuery\.set\('shop_id'/,
  'shop-scoped histories must be filtered without hiding business-wide movements');
const playwrightConfig=fs.readFileSync('playwright.admin.config.ts','utf8');
const plan7Workflow=fs.readFileSync('.github/workflows/admin-plan7-finance-reports-tdd.yml','utf8');
assert(playwrightConfig.includes('workforce|finance|reports'), 'Plan 7 tests are matched');
assert.match(plan7Workflow,/test:e2e:admin/,
  'Plan 7 permanent workflow must execute real browser E2E, not only static gates');
assert.equal(config.routes.some(r=>r.src==='/api/cron/admin-recurring-expenses'),false);
assert.equal(gateway.includes('handleRecurringDueCronRequest'),false);
assert.equal(fs.existsSync('.github/workflows/admin-recurring-expenses-due.yml'),false);
assert.equal(fs.existsSync('apps/admin/server/finance/recurringCronApi.ts'),false);
const bff=fs.readFileSync('apps/admin/server/finance/financeOperationsApi.ts','utf8');
assert.match(bff,/process_due_recurring_expenses_v2/);
assert.match(bff,/finance\.recurring\.process/);
const dueSql=fs.readFileSync('supabase/migrations/20261008140000_admin_plan7_recurring_due_trusted_fallback.sql','utf8');
assert.match(dueSql,/for update skip locked/);
assert.match(dueSql,/on conflict\(rule_id,due_on\) do nothing/);
assert.match(dueSql,/p_max_rules not between 1 and 25/);
assert.equal(Object.hasOwn(config,'crons'),false,'Vercel cron remains prohibited');
console.log('Plan 7 Finance/Reports/recurring gateway and Hobby function budget invariant passed.');

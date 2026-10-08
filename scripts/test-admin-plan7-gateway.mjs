import assert from 'node:assert/strict';
import fs from 'node:fs';

const config=JSON.parse(fs.readFileSync('apps/admin/vercel.json','utf8'));
const gateway=fs.readFileSync('apps/admin/api/admin/orders.ts','utf8');
const cron=fs.readFileSync('apps/admin/server/finance/recurringCronApi.ts','utf8');

for (const [path,resource,handler] of [
  ['/api/admin/finance','finance','handleFinanceRequest'],
  ['/api/admin/reports','reports','handleReportsRequest'],
  ['/api/cron/admin-recurring-expenses','recurring-due','handleRecurringDueCronRequest'],
]) {
  assert(config.routes.some((r)=>r.src===path&&r.dest===
    `/api/admin/orders?__adminResource=${resource}`),`missing gateway route: ${path}`);
  assert(gateway.includes(handler),`gateway must dispatch ${handler}`);
}
for (const path of [
  'apps/admin/api/admin/finance.ts',
  'apps/admin/api/admin/reports.ts',
  'apps/admin/api/cron/admin-recurring-expenses.ts',
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
assert.match(cron,/timingSafeEqual/);
assert.match(cron,/CRON_SECRET/);
assert.match(cron,/require|Bearer|unauthorized/);
assert.equal(Object.hasOwn(config,'crons'),false,'Vercel cron remains prohibited');
console.log('Plan 7 Finance/Reports/recurring gateway and Hobby function budget invariant passed.');

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl||!['localhost','127.0.0.1','::1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Plan 7 full behavior requires loopback TEST_DATABASE_URL');
}
function sql(query,label,expectedFailure=false) {
  const run=spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-At','-c',query],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  if ((run.status!==0)!==expectedFailure) {
    process.stderr.write(run.stderr??'');
    throw new Error(`${label}: unexpected exit ${run.status}`);
  }
  return run.stdout.trim();
}
function rpc(expression,label) {
  return JSON.parse(sql(`select (${expression})::text;`,label));
}
const b='31000000-0000-4000-8000-000000000001';
const s='32000000-0000-4000-8000-000000000001';
const e='33000000-0000-4000-8000-000000000001';
const w='35000000-0000-4000-8000-000000000001';
const day='36000000-0000-4000-8000-000000000001';
const today=sql("select (now() at time zone 'Africa/Cairo')::date",'Cairo current date');
const cashId=sql(`select id from public.finance_accounts where business_id='${b}' and account_type='CASH'`,'existing account');
assert(cashId);
sql(`insert into public.workers(id,shop_id,display_name,pin_hash,active)
values('${w}','${s}','Financial test cashier','test-credential',true);
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id)
values('${day}','${s}','OPEN',now() - interval '1 hour','${w}');`,'new Operations day fixture');

const activated=rpc(`public.set_finance_account_active_v1(
  '${e}'::uuid,'${s}'::uuid,'${cashId}'::uuid,2,true,'reenable-finance-cash')`,'reactivate cash');
assert.equal(activated.ok,true);

const manager='33000000-0000-4000-8000-000000000003';
sql(`insert into public.business_employees(id,business_id,display_name,role,active)
  values ('${manager}','${b}','Finance manager','MANAGER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
  values ('${b}','${manager}','${s}');
insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect)
  values ('${b}','${manager}','finance.adjust','ALLOW');`,'shop-scoped finance manager');
const bank=rpc(`public.create_finance_account_v1(
  '${e}'::uuid,'${s}'::uuid,'${s}'::uuid,'BANK','Financial Test Bank',0,'new-bank')`,'create bank');
assert.equal(bank.ok,true);
const pending=rpc(`public.create_finance_account_v1(
  '${e}'::uuid,'${s}'::uuid,'${s}'::uuid,'PENDING_SETTLEMENT',
  'Financial Test Pending',0,'new-pending')`,'create pending');
assert.equal(pending.ok,true);

function movement(action,payload,commandId) {
  return rpc(`public.execute_finance_management_v1(
    '${e}'::uuid,'${s}'::uuid,'${action}',
    '${JSON.stringify(payload)}'::jsonb,'${commandId}')`,action);
}
const globalBank=rpc(`public.create_finance_account_v1(
  '${e}'::uuid,'${s}'::uuid,null::uuid,'BANK',
  'Global treasury',0,'new-global-bank')`,'owner creates business treasury');
assert.equal(globalBank.ok,true);
const managerCommand=(action,payload,commandId)=>rpc(`public.execute_finance_management_v1(
  '${manager}'::uuid,'${s}'::uuid,'${action}',
  '${JSON.stringify(payload)}'::jsonb,'${commandId}')`, 'manager financial command');
assert.equal(managerCommand('TRANSFER',{
  fromAccountId:cashId,toAccountId:globalBank.accountId,
  amountMinor:250,reason:'Manager transfer into global treasury',
},'manager-global-transfer').code,'permission_forbidden',
  'a shop-scoped manager cannot move funds into/out of business treasury');
assert.equal(managerCommand('OWNER_WITHDRAWAL',{
  fromAccountId:cashId,amountMinor:250,reason:'Unauthorized owner capital withdrawal',
},'manager-owner-withdraw').code,'permission_forbidden',
  'owner capital movements require OWNER or ADMIN role');

assert.equal(managerCommand('TRANSFER',{
  fromAccountId:cashId,toAccountId:bank.accountId,
  amountMinor:100,reason:'Authorized shop-internal movement',
},'manager-shop-transfer').ok,true,
  'shop-scoped finance.adjust must remain functional');

const owner=movement('OWNER_CONTRIBUTION',{
  fromAccountId:cashId,amountMinor:50000,reason:'Owner investment, not sales',
},'test-owner-deposit');
assert.equal(owner.ok,true);
assert.equal(movement('OWNER_CONTRIBUTION',{
  fromAccountId:cashId,amountMinor:50000,reason:'Owner investment, not sales',
},'test-owner-deposit').replayed,true);
assert.equal(movement('OWNER_CONTRIBUTION',{
  fromAccountId:cashId,amountMinor:123,reason:'conflicting replay',
},'test-owner-deposit').code,'finance_command_conflict');

const transfer=movement('TRANSFER',{
  fromAccountId:cashId,toAccountId:bank.accountId,
  amountMinor:10000,reason:'Internal location of money',
},'test-transfer');
assert.equal(transfer.ok,true);
assert.equal(
  sql("select sum(amount_minor) from public.finance_movements where command_id='plan7:test-transfer'",'transfer net'),
  '0');

const expense=movement('EXPENSE',{
  fromAccountId:cashId,businessDayId:day,expenseDate:today,
  amountMinor:1200,description:'Admin utility expense',
  categoryId:null,reason:'Office utility payment',
},'test-expense');
assert.equal(expense.ok,true);
assert.equal(sql(`select created_by_employee_id from public.expenses where id='${expense.expenseId}'`,'admin actor'),e);
assert.equal(sql(`select created_by_worker_id is null from public.expenses where id='${expense.expenseId}'`,'truthful actor'),'t');
assert.equal(sql(`select count(*) from public.finance_movements where source_id='${expense.expenseId}'`,'one expense movement'),'1');
sql(`update public.expenses set description='destructive edit' where id='${expense.expenseId}'`,'immutable expense',true);

assert.equal(movement('OWNER_CONTRIBUTION',{
  fromAccountId:pending.accountId,amountMinor:10000,reason:'Pending settlement source',
},'test-pending-source').ok,true);
const settlement=movement('SETTLEMENT',{
  fromAccountId:pending.accountId,toAccountId:bank.accountId,
  amountMinor:8000,feeMinor:300,reason:'Provider settlement',
  settledOn:today,
},'test-settlement');
assert.equal(settlement.ok,true);
assert.equal(
  sql("select sum(amount_minor) from public.finance_movements where command_id='plan7:test-settlement'",'settlement fee conservation'),
  '-300');
assert.equal(sql("select count(*) from public.payment_settlements where command_id='test-settlement'",'settlement fact'),'1');

const x=rpc(`public.finance_day_report_v1('${e}'::uuid,'${s}'::uuid,'${day}'::uuid)`,'OPEN X');
assert.equal(x.businessDayStatus,'OPEN');
assert.equal(x.bankFeesMinor,300,'provider fees are operating expenses');
assert.equal(x.totalExpensesMinor,1500,'manual expense and bank fee both counted');
assert.equal(x.estimatedOperatingProfitMinor,-1500,'settlement fees reduce X profit exactly once');
assert.equal(sql(`select status from public.business_days where id='${day}'`,'X non-closing'),'OPEN');
const earlyZ=rpc(`public.finance_finalize_day_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'z-before-ops')`,'reject early Z');
assert.equal(earlyZ.code,'finance_day_must_be_closed');

const createdRule=rpc(`public.upsert_recurring_expense_rule_v1(
  '${e}'::uuid,'${s}'::uuid,null::uuid,0,null::uuid,
  'Recurring utilities',250,'MONTHLY','${today}'::date,true,'new-utilities-rule')`,'recurring definition');
assert.equal(createdRule.ok,true);
const generated=Number(sql(`select public.generate_due_recurring_expenses_v1('${today}'::date)`,'generate due expense'));
assert.equal(generated,1);
const due=rpc(`public.finance_recurring_workspace_v1('${e}'::uuid,'${s}'::uuid)`,'recurring due read');
assert.equal(due.due.length,1);
const occurrenceId=due.due[0].id;
const paid=rpc(`public.post_recurring_expense_occurrence_v1(
  '${e}'::uuid,'${s}'::uuid,'${occurrenceId}'::uuid,
  '${day}'::uuid,'${cashId}'::uuid,'Confirmed recurring utility',
  'post-due-expense')`,'post one recurring expense');
assert.equal(paid.ok,true);
assert.equal(sql(`select status from public.recurring_expense_occurrences where id='${occurrenceId}'`,'due posted'),'RECORDED');

// A real costed consumption must reduce, never inflate, management profit.
sql(`insert into public.inventory_items(id,shop_id,name,unit_label,tracking_mode,
  low_stock_threshold_micros,active) values
  ('37000000-0000-4000-8000-000000000001','${s}','Costed ingredient','kg',
   'RECIPE_TRACKED',0,true);
insert into public.inventory_movements(id,shop_id,business_day_id,inventory_item_id,
 movement_type,quantity_delta_micros,worker_id,idempotency_key,created_at,unit_cost_minor)
values
 ('38000000-0000-4000-8000-000000000001','${s}','${day}',
  '37000000-0000-4000-8000-000000000001','BULK_STOCK_RECEIVED',2000000,
  '${w}','plan7-profit-stock',now(),400);`,'seed two units of ingredient');

sql(`insert into public.inventory_cost_state(
  shop_id,inventory_item_id,weighted_unit_cost_minor,version)
values('${s}','37000000-0000-4000-8000-000000000001',400,1);
insert into public.inventory_movements(id,shop_id,business_day_id,inventory_item_id,
 movement_type,quantity_delta_micros,worker_id,idempotency_key,created_at,unit_cost_minor)
values('38000000-0000-4000-8000-000000000002','${s}','${day}',
 '37000000-0000-4000-8000-000000000001','ORDER_CONSUMPTION',-1000000,
 '${w}','plan7-profit-consumption',now(),0);`,'materialize consumption from canonical weighted cost');
assert.equal(sql(`select unit_cost_minor from public.inventory_movements
  where id='38000000-0000-4000-8000-000000000002'`,
  'immutable consumption cost snapshot'),'400.000000',
  'server cost binding ignores client supplied zero and uses trusted weighted state');

// Bank & Cash must show the authoritative latest-day operating estimate, not a permanent placeholder.
const workspaceProfit=rpc(`public.finance_workspace_v1('${e}'::uuid,'${s}'::uuid)`,
  'finance workspace profit readback');
assert.equal(workspaceProfit.ok,true);
assert(workspaceProfit.profitSummary,'cost-complete day produces a profit summary');
assert.equal(workspaceProfit.profitSummary.netSalesMinor,0);
assert.equal(workspaceProfit.profitSummary.cogsMinor,400);
assert.equal(workspaceProfit.profitSummary.expensesMinor,1750);
assert.equal(workspaceProfit.profitSummary.estimatedOperatingProfitMinor,-2150);
assert.equal(workspaceProfit.profitSummary.businessDayId,day);

const nowReport=rpc(`public.admin_finance_report_query_v1(
  '${e}'::uuid,array['${s}'::uuid],'expenses',
  '${today}'::date,'${today}'::date,50,0,null::text)`,'expense report');
assert.equal(nowReport.ok,true);
assert.equal(nowReport.summary.orderCount,0,'no canonical orders in finance expense fixture');
assert(nowReport.summary.eventCount>=2,'canonical manual and recurring expenses in report');
assert.equal(nowReport.summary.totalAmountMinor,-1750,
  'manual expenses, recurring expense and provider BANK_FEE are each included once');
const profitReport=rpc(`public.admin_finance_report_query_v1(
  '${e}'::uuid,array['${s}'::uuid],'profit',
  '${today}'::date,'${today}'::date,50,0,null::text)`,'costed operating profit');
assert.equal(profitReport.ok,true);
assert.equal(profitReport.summary.totalAmountMinor,-2150,
  'zero sales minus 1450 manual expenses, 300 provider fee and 400 COGS');
const consumptionReport=rpc(`public.admin_finance_report_query_v1(
  '${e}'::uuid,array['${s}'::uuid],'inventory-consumption',
  '${today}'::date,'${today}'::date,50,0,null::text)`,'inventory consumption cost');
assert.equal(consumptionReport.summary.totalAmountMinor,400,
  'consumption report remains a positive cost measure');


for (const area of ['loyalty','promotions','segments','attendance','refunds','staff','purchasing']) {
  const expanded=rpc(`public.admin_finance_report_query_v2(
    '${e}'::uuid,array['${s}'::uuid],'${area}',
    '${today}'::date,'${today}'::date,50,0,null::text,'{}'::jsonb)`,
    'expanded area '+area);
  assert.equal(expanded.ok,true, 'canonical area '+area+' must return an authorized report');
}
const v2Expense=rpc(`public.admin_finance_report_query_v2(
  '${e}'::uuid,array['${s}'::uuid],'expenses',
  '${today}'::date,'${today}'::date,50,0,null::text,'{}'::jsonb)`,
  'v2 expense totals');
assert.equal(v2Expense.summary.totalAmountMinor,nowReport.summary.totalAmountMinor,
  'context v2 does not alter unfiltered finance totals');
const deniedContext=rpc(`public.admin_finance_report_query_v2(
  '${e}'::uuid,array['${s}'::uuid],'expenses',
  '${today}'::date,'${today}'::date,50,0,null::text,
  '{"orderTypeId":"00000000-0000-4000-8000-000000000001"}'::jsonb)`,
  'unsupported contextual filter');
assert.equal(deniedContext.code,'report_context_invalid',
  'unapplicable context cannot return misleading unfiltered results');

const targets=rpc(`public.admin_report_config_command_v1(
  '${e}'::uuid,'${s}'::uuid,'SET_TARGET',
  '{"metric":"NET_SALES","periodStart":"${today}","periodEnd":"${today}","targetValue":4000,"expectedVersion":0}'::jsonb,
  'test-target')`,'write target');
assert.equal(targets.ok,true);
const view=rpc(`public.admin_report_config_command_v1(
  '${e}'::uuid,'${s}'::uuid,'SAVE_VIEW',
  '{"id":null,"expectedVersion":0,"name":"This day","reportArea":"expenses","filters":{},"layout":{}}'::jsonb,
  'test-saved-view')`,'save view');
assert.equal(view.ok,true);
const reportConfig=rpc(`public.admin_report_config_query_v1('${e}'::uuid,'${s}'::uuid)`,'report configuration');
assert.equal(reportConfig.targets.length,1);
assert.equal(reportConfig.savedViews.length,1);

sql(`update public.business_days set status='CLOSED',ended_at=now(),
  ended_by_worker_id='${w}' where id='${day}';`,'fixture Operations close');
const cashier=rpc(`public.finance_reconcile_cashier_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'${w}'::uuid,0,null::text,'count-zero')`,'cashier count');
assert.equal(cashier.ok,true);
const z=rpc(`public.finance_finalize_day_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'finalize-after-ops')`,'finalize financial Z');
assert.equal(z.ok,true);
assert.equal(rpc(`public.finance_finalize_day_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'finalize-after-ops')`,'idempotent Z').replayed,true);
assert.equal(sql(`select count(*) from public.end_day_financial_snapshots where business_day_id='${day}'`,'single Z'),'1');
assert.equal(sql(`select count(*) from public.daily_owner_summaries where business_day_id='${day}'`,'owner summary created'),'1');
assert.equal(sql(`select summary->>'cashVarianceMinor' from public.daily_owner_summaries where business_day_id='${day}'`,'monetary cash variance'),'0');
const correction=rpc(`public.finance_adjust_snapshot_v1(
  '${e}'::uuid,'${s}'::uuid,'${z.snapshotId}'::uuid,100,
  'Explicit correction event','test-correction')`,'append correction');
assert.equal(correction.ok,true);
sql(`update public.end_day_financial_snapshots set snapshot='{}' where id='${z.snapshotId}'`,'Z immutable',true);
assert.equal(sql(`select status from public.business_days where id='${day}'`,'Admin never reopens'),'CLOSED');

for (const signature of [
  'public.finance_day_report_v1(uuid,uuid,uuid)',
  'public.finance_finalize_day_v1(uuid,uuid,uuid,text)',
  'public.execute_finance_management_v1(uuid,uuid,text,jsonb,text)',
  'public.admin_finance_report_query_v1(uuid,uuid[],text,date,date,integer,integer,text)',
]) {
  assert.equal(sql(`select has_function_privilege('anon','${signature}','EXECUTE')`,'deny browser'),'f');
}
console.log('Plan 7 complete management, X/Z, report, recurrence and audit integration passed.');

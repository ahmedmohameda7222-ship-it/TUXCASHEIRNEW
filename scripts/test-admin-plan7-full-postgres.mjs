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
assert.equal(x.totalExpensesMinor,1200);
assert.equal(x.estimatedOperatingProfitMinor,-1200);
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

const nowReport=rpc(`public.admin_finance_report_query_v1(
  '${e}'::uuid,array['${s}'::uuid],'expenses',
  '${today}'::date,'${today}'::date,50,0,null::text)`,'expense report');
assert.equal(nowReport.ok,true);
assert(nowReport.summary.eventCount>=2,'canonical manual and recurring expenses in report');
assert.equal(nowReport.summary.totalAmountMinor,-1450);

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

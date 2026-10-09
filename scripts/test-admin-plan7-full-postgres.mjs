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
const generated=rpc(`public.process_due_recurring_expenses_v2('${e}'::uuid,'${s}'::uuid,'${today}'::date,25)`,'scoped due processing');
assert.equal(generated.ok,true);
assert.equal(generated.dueOccurrencesGenerated,1);
assert.equal(rpc(`public.process_due_recurring_expenses_v2('${e}'::uuid,'${s}'::uuid,'${today}'::date,25)`,'due replay').dueOccurrencesGenerated,0);
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
const supplierA='39000000-0000-4000-8000-000000000001';
const supplierB='39000000-0000-4000-8000-000000000002';
sql(`insert into public.suppliers(
 id,business_id,name,created_by_employee_id,create_command_id)
values ('${supplierA}','${b}','Supplier A','${e}','supplier-a'),
       ('${supplierB}','${b}','Supplier B','${e}','supplier-b');
insert into public.purchase_orders(
 business_id,shop_id,supplier_id,status,created_by_employee_id,create_command_id,ordered_at)
values ('${b}','${s}','${supplierA}','DRAFT','${e}','purchase-a',null),
       ('${b}','${s}','${supplierB}','ORDERED','${e}','purchase-b',now());`,
 'canonical purchase order report facts');
const contextPurchasing=(context)=>rpc(`public.admin_finance_report_query_v2(
 '${e}'::uuid,array['${s}'::uuid],'purchasing',
 '${today}'::date,'${today}'::date,50,0,null::text,
 '${JSON.stringify(context)}'::jsonb)`,'contextual purchasing');
assert.equal(contextPurchasing({}).summary.eventCount,2);
assert.equal(contextPurchasing({supplierId:supplierA}).summary.eventCount,1,
 'supplier filtering must apply to summary, not merely paginated rows');
assert.equal(contextPurchasing({status:'DRAFT'}).summary.eventCount,1);
assert.equal(contextPurchasing({supplierId:supplierA,status:'ORDERED'}).summary.eventCount,0,
 'combined filters must not leak mismatched supplier facts');

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

const dashboard=rpc(`public.admin_plan7_dashboard_metrics_v1(
  '${e}'::uuid,array['${s}'::uuid],'${today}'::date,'${today}'::date)`,
  'server-authoritative Home dashboard');
assert.equal(dashboard.ok,true);
assert.equal(dashboard.netSalesMinor,0);
assert.equal(dashboard.orderCount,0);
assert.equal(dashboard.averageOrderMinor,null);
assert.equal(dashboard.estimatedOperatingProfitMinor,-2150);
assert.equal(dashboard.salesTrend.length,1);
assert.equal(dashboard.shopComparison.length,1);
assert.equal(dashboard.sourceMix.length,0);

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

// A physical cash drawer includes recorded float and drawer pay-in/out,
 // not only paid cash orders. Use canonical worker-provenance money movements.
sql(`insert into public.finance_movements(
 business_id,shop_id,finance_account_id,movement_type,amount_minor,
 command_id,request_fingerprint,actor_worker_id)
values
 ('${b}','${s}','${cashId}','OPENING_FLOAT',2500,'drawer-float',
  repeat('1',64),'${w}'),
 ('${b}','${s}','${cashId}','PAY_IN',1000,'drawer-pay-in',
  repeat('2',64),'${w}'),
 ('${b}','${s}','${cashId}','PAY_OUT',-300,'drawer-pay-out',
  repeat('3',64),'${w}');`,'trusted cashier float and pay-in/out');
const drawer=rpc(`private.plan7_drawer_facts_v1(
 '${b}'::uuid,'${s}'::uuid,'${day}'::uuid,'${w}'::uuid)`,
 'materialized drawer cash evidence');
assert.equal(drawer.cashSalesExpectationMinor,0);
assert.equal(drawer.recordedCashMovementMinor,3200);
assert.equal(drawer.recordedDrawerExpectationMinor,3200);
assert.equal(drawer.openingFloatRecorded,true);
const drawerWorkspace=rpc(`public.finance_cashier_expectations_v1(
 '${e}'::uuid,'${s}'::uuid,'${day}'::uuid)`,'cashier drawer read model');
assert.equal(drawerWorkspace.ok,true);
assert.equal(drawerWorkspace.cashiers.find(c=>c.cashierWorkerId===w).expectedMinor,3200);
const cashOnlyX=rpc(`public.finance_day_report_v1(
 '${e}'::uuid,'${s}'::uuid,'${day}'::uuid)`,'cash-only cashier X report');
assert.equal(cashOnlyX.openingFloatMinor,2500,'cash float is distinct from sales');
assert.equal(cashOnlyX.cashPayInsMinor,1000,'pay-ins are a separate ledger class');
assert.equal(cashOnlyX.cashPayOutsMinor,300,'pay-outs are a separate ledger class');
assert.equal(cashOnlyX.bankDepositsMinor,0,'normal transfers are not bank deposits');
assert.equal(cashOnlyX.cashExpensesMinor,1450,'cash includes recorded recurring expense');
assert.equal(cashOnlyX.transfersOutMinor,10100,'transfers are directional, not revenue');
assert.equal(cashOnlyX.transfersInMinor,10100,'internal transfers conserve funds');
assert.equal(cashOnlyX.missingCashierReconciliationCount,1,
  'unreconciled opening float/pay-in/out worker must block financial Z');


sql(`update public.business_days set status='CLOSED',ended_at=now(),
  ended_by_worker_id='${w}' where id='${day}';`,'fixture Operations close');
const cashier=rpc(`public.finance_reconcile_cashier_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'${w}'::uuid,3300,'Recorded cash overage','count-positive')`,'cashier count');
assert.equal(cashier.ok,true);
assert.equal(cashier.expectedMinor,3200);
assert.equal(cashier.varianceMinor,100);
const z=rpc(`public.finance_finalize_day_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'finalize-after-ops')`,'finalize financial Z');
assert.equal(z.ok,true);
const finalizedZ=rpc(`(select snapshot from public.end_day_financial_snapshots
  where id='${z.snapshotId}'::uuid)`,'frozen classified Z');
for (const key of ['openingFloatMinor','cashPayInsMinor','cashPayOutsMinor',
  'cashExpensesMinor','transfersInMinor','transfersOutMinor','bankDepositsMinor']) {
 assert.equal(finalizedZ[key],cashOnlyX[key],'Z freezes '+key);
}

assert.equal(rpc(`public.finance_finalize_day_v1(
  '${e}'::uuid,'${s}'::uuid,'${day}'::uuid,'finalize-after-ops')`,'idempotent Z').replayed,true);
assert.equal(sql(`select count(*) from public.end_day_financial_snapshots where business_day_id='${day}'`,'single Z'),'1');
assert.equal(sql(`select count(*) from public.daily_owner_summaries where business_day_id='${day}'`,'owner summary created'),'1');
assert.equal(sql(`select summary->>'cashVarianceMinor' from public.daily_owner_summaries where business_day_id='${day}'`,'monetary cash variance'),'100');
const correction=rpc(`public.finance_adjust_snapshot_v1(
  '${e}'::uuid,'${s}'::uuid,'${z.snapshotId}'::uuid,100,
  'Explicit correction event','test-correction')`,'append correction');
assert.equal(correction.ok,true);
const frozenZAfterCorrection=rpc(`(select snapshot from public.end_day_financial_snapshots
 where id='${z.snapshotId}'::uuid)`,'financial Z after later adjustment');
assert.deepEqual(frozenZAfterCorrection,finalizedZ,
 'later immutable adjustment must not rewrite any frozen Z financial or movement facts');
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
// Dashboard AOV must exclude unpaid and cancelled orders from its divisor.
const orderType='38000000-0000-4000-8000-000000000001';
const paymentMethod='39000000-0000-4000-8000-000000000001';
const paidOrder='40000000-0000-4000-8000-000000000001';
const cancelledOrder='40000000-0000-4000-8000-000000000002';
const newDay='41000000-0000-4000-8000-000000000001';
sql(`insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id)
 values ('${newDay}','${s}','OPEN',now(),'${w}');
insert into public.order_types(id,shop_id,name,behavior,active,sort_order)
 values ('${orderType}','${s}','Takeaway','TAKE_AWAY',true,1);
insert into public.payment_methods(id,shop_id,display_name,logic_type,requires_reconciliation,active,sort_order)
 values ('${paymentMethod}','${s}','AOV test cash','CASH',false,true,1);
insert into public.orders(
 id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,
 operator_worker_id,operator_name_snapshot,order_type_id,
 order_type_label_snapshot,order_type_behavior_snapshot,
 configured_delivery_fee_minor,final_delivery_fee_minor,
 items_subtotal_minor,discount_minor,total_minor,
 created_at,updated_at,operational_revision,service_charge_minor,tax_minor,
 cancelled_at,cancelled_by_worker_id,cancelled_by_worker_name_snapshot,
 cancellation_reason,cancellation_food_prepared,cancellation_stock_restored
) values
 ('${paidOrder}','${s}','${newDay}',1,'aov-paid','POS','DONE',
 '${w}','Cashier','${orderType}','Takeaway','TAKE_AWAY',
 0,0,10000,0,10000,now(),now(),0,0,0,null,null,null,null,null,null),
 ('${cancelledOrder}','${s}','${newDay}',2,'aov-cancelled','POS','CANCELLED',
 '${w}','Cashier','${orderType}','Takeaway','TAKE_AWAY',
 0,0,5000,0,5000,now(),now(),0,0,0,
 now(),'${w}','Cashier','AOV test cancellation',false,false);
insert into public.payments(
 id,shop_id,order_id,part_index,payment_method_id,
 payment_method_label_snapshot,logic_type_snapshot,
 allocated_minor,received_minor,change_minor,created_at
) values (gen_random_uuid(),'${s}','${paidOrder}',1,'${paymentMethod}',
 'Cash','CASH',10000,10000,0,now());`, 'AOV with one paid and one cancelled order');
const average=rpc(`public.admin_plan7_dashboard_metrics_v1(
 '${e}'::uuid,array['${s}'::uuid],'${today}'::date,'${today}'::date)`,
 'exclude unpaid orders from average order value');
assert.equal(average.orderCount,2,'total orders still includes cancelled operational orders');
assert.equal(average.netSalesMinor,10000,'only actual paid cash is net sales');
assert.equal(average.averageOrderMinor,10000,
  'average order value must divide by paid orders, not by all operational orders');

const unpaid='40000000-0000-4000-8000-000000000003';
const category='46000000-0000-4000-8000-000000000001';
const espresso='47000000-0000-4000-8000-000000000001';
const latte='47000000-0000-4000-8000-000000000002';
sql(`insert into public.menu_categories(id,shop_id,name,sort_order) values
 ('${category}','${s}','Daily sales',0);
insert into public.products(id,shop_id,category_id,name,price_minor,sort_order) values
 ('${espresso}','${s}','${category}','Espresso',500,0),
 ('${latte}','${s}','${category}','Latte',1000,1);
insert into public.orders(id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,
 operator_worker_id,operator_name_snapshot,order_type_id,order_type_label_snapshot,
 order_type_behavior_snapshot,configured_delivery_fee_minor,final_delivery_fee_minor,
 items_subtotal_minor,discount_minor,total_minor,created_at,updated_at,
 operational_revision,service_charge_minor,tax_minor) values
 ('${unpaid}','${s}','${newDay}',3,'unpaid-active','POS','ACTIVE',
 '${w}','Cashier','${orderType}','Takeaway','TAKE_AWAY',0,0,2500,0,2500,
 now(),now(),0,0,0);
insert into public.order_items(id,shop_id,order_id,product_id,product_name_snapshot,
 unit_price_minor,quantity,line_position) values
 (gen_random_uuid(),'${s}','${unpaid}','${espresso}','Espresso',500,5,1),
 (gen_random_uuid(),'${s}','${paidOrder}','${latte}','Latte',1000,2,1),
 (gen_random_uuid(),'${s}','${cancelledOrder}','${espresso}','Espresso',500,1,1);`,
 'paid and unpaid top-product fixture');
const products=rpc(`public.admin_plan7_dashboard_metrics_v1(
 '${e}'::uuid,array['${s}'::uuid],'${today}'::date,'${today}'::date)`,
 'paid-only Top Products');
assert.deepEqual(products.topProducts.map(p=>[p.name,p.quantity]),[['Latte',2]]);


 // Product Performance uses paid order participation, never operational order existence.
const splitOrder='40000000-0000-4000-8000-000000000004';
sql(`insert into public.orders(id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,
 operator_worker_id,operator_name_snapshot,order_type_id,order_type_label_snapshot,
 order_type_behavior_snapshot,configured_delivery_fee_minor,final_delivery_fee_minor,
 items_subtotal_minor,discount_minor,total_minor,created_at,updated_at,
 operational_revision,service_charge_minor,tax_minor) values
 ('${splitOrder}','${s}','${newDay}',4,'split-paid','POS','DONE',
 '${w}','Cashier','${orderType}','Takeaway','TAKE_AWAY',0,0,3000,0,3000,
 now(),now(),0,0,0);
insert into public.order_items(id,shop_id,order_id,product_id,product_name_snapshot,
 unit_price_minor,quantity,line_position) values
 (gen_random_uuid(),'${s}','${splitOrder}','${latte}','Latte',1000,3,1);
insert into public.payments(id,shop_id,order_id,part_index,payment_method_id,
 payment_method_label_snapshot,logic_type_snapshot,allocated_minor,received_minor,
 change_minor,created_at) values
 (gen_random_uuid(),'${s}','${splitOrder}',1,'${paymentMethod}',
 'Cash','CASH',1500,1500,0,now()),
 (gen_random_uuid(),'${s}','${splitOrder}',2,'${paymentMethod}',
 'Cash','CASH',1500,1500,0,now());`, 'split-payment product fixture');
const productReport=(context)=>rpc(`public.admin_finance_report_query_v2(
 '${e}'::uuid,array['${s}'::uuid],'products',
 '${today}'::date,'${today}'::date,50,0,null::text,
 '${JSON.stringify(context)}'::jsonb)`, 'Product Performance paid participation');
const allProductReport=productReport({});
assert.equal(allProductReport.ok,true);
assert.equal(allProductReport.rows.filter(row=>row.sourceKind==='order-item').length,2,
 'only two paid order item events (no unpaid active/cancelled events)');
assert.equal(allProductReport.summary.totalQuantity,5,
 'split payments must not multiply paid product quantity');
assert.equal(allProductReport.summary.totalAmountMinor,5000,
 'split payments must not multiply recorded item sale amount');
assert.deepEqual(allProductReport.rows.map(row=>row.label),['Latte','Latte']);
assert.equal(productReport({productId:espresso}).summary.totalQuantity,0,
 'unpaid ACTIVE and CANCELLED Espresso never contribute product quantity');
assert.equal(productReport({productId:latte}).summary.totalQuantity,5,
 'product context preserves paid participation');
assert.equal(productReport({categoryId:category}).summary.totalQuantity,5,
 'category context preserves paid participation');

const limited='45000000-0000-4000-8000-000000000001';
sql(`insert into public.business_employees(id,business_id,display_name,role,active)
values ('${limited}','${b}','Custom permission staff','STAFF',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
values ('${b}','${limited}','${s}');
insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect)
values ('${b}','${limited}','reports.view','ALLOW'),
('${b}','${limited}','finance.view','DENY');`, 'mixed staff permission fixture');
const limitedProfit=rpc(`public.admin_finance_report_query_v2(
'${limited}'::uuid,array['${s}'::uuid],'profit',
'${today}'::date,'${today}'::date,20,0,null::text,'{}'::jsonb)`, 'staff profit denial');
assert.equal(limitedProfit.code,'permission_forbidden');
const limitedDashboard=rpc(`public.admin_plan7_dashboard_metrics_v1(
'${limited}'::uuid,array['${s}'::uuid],
'${today}'::date,'${today}'::date)`, 'staff dashboard masking');
assert.equal(limitedDashboard.ok,true);
assert.equal(limitedDashboard.estimatedOperatingProfitMinor,null);
const costTarget=rpc(`public.admin_report_config_command_v1(
  '${e}'::uuid,'${s}'::uuid,'SET_TARGET',
  '{"metric":"FOOD_COST_PERCENT","periodStart":"${today}","periodEnd":"${today}","targetValue":3000,"expectedVersion":0}'::jsonb,
  'finance-cost-target')`,'create finance-only target');
assert.equal(costTarget.ok,true);
const limitedConfig=rpc(`public.admin_report_config_query_v1(
 '${limited}'::uuid,'${s}'::uuid)`,'staff config isolation');
assert.deepEqual(limitedConfig.targets.map(t=>t.metric),['NET_SALES'],
  'reports.view keeps its sales target but must hide finance-only cost targets');

console.log('Plan 7 complete management, X/Z, report, recurrence and audit integration passed.');

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Load REAL existing Purchasing RPC definitions against disposable stock ledger.
// Never execute against the canonical Supabase project.
const db = process.env.TEST_DATABASE_URL;
if (!db || !['localhost','127.0.0.1','::1'].includes(new URL(db).hostname)) {
  throw new Error('I3 Purchasing bridge requires localhost TEST_DATABASE_URL');
}
function command(args, label, expectFailure = false, needle = '') {
  const run = spawnSync('psql', [db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  const out = (run.stdout || '') + (run.stderr || '');
  if ((!expectFailure && run.status !== 0) ||
      (expectFailure && (run.status === 0 || !out.includes(needle)))) {
    throw new Error(label + ': ' + out.slice(-3500));
  }
  return (run.stdout || '').trim();
}
const sql = (q) => command(['-At', '-c', q], 'PostgreSQL query');
function q(v) {
  if (v === null) return 'NULL';
  if (Array.isArray(v) || typeof v === 'object')
    return "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replaceAll("'", "''") + "'";
}
function call(fn, args) {
  return JSON.parse(sql('select (public.' + fn + '(' + args.map(q).join(',') + '))::text'));
}
function check(condition, label) {
  if (!condition) throw new Error(label);
}
function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(label + ': expected ' + expected + ', actual ' + actual);
}

const base = spawnSync(process.execPath, ['scripts/test-inventory-isolated-postgres.mjs'], {
  env: process.env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
if (base.status !== 0) throw new Error('Inventory fixture: ' + (base.stderr || '').slice(-3000));

const source = readFileSync('supabase/migrations/20260910150000_admin_purchasing.sql','utf8');
function extract(token, tail) {
  const start = source.toLowerCase().indexOf(token.toLowerCase());
  if (start < 0) throw new Error('Missing production Purchasing source ' + token);
  const end = source.indexOf(tail, start);
  if (end < 0) throw new Error('Unterminated production Purchasing source ' + token);
  return source.slice(start, end + tail.length);
}
const schema = [
  'create table public.businesses(id uuid primary key);',
  'insert into public.businesses select distinct business_id from public.shops;',
  'alter table public.business_employees add constraint test_employee_business_unique unique(business_id,id);',
  'create table public.business_shops(business_id uuid references public.businesses(id),shop_id uuid references public.shops(id),primary key(business_id,shop_id));',
  'insert into public.business_shops select business_id,id from public.shops;',
  // Authority and audit fixtures only. All Purchasing business RPCs remain real.
  'create function public.resolve_admin_authorization_v1(p_employee_id uuid,p_shop_id uuid,p_permission text) ' +
    'returns table(authorized boolean,business_id uuid) language sql stable ' +
    'as $auth$ select exists(select 1 from public.business_employees e ' +
    'join public.shops sh on sh.business_id=e.business_id where e.id=p_employee_id ' +
    "and e.active and sh.id=p_shop_id and p_permission in ('purchasing.receive','purchasing.manage'))," +
    '(select sh.business_id from public.shops sh where sh.id=p_shop_id) $auth$;',
  'create function public.append_admin_audit_event_v1(' +
    'uuid,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,jsonb) ' +
    'returns void language plpgsql as $audit$ begin return; end $audit$;',
].join('\n');
command(['-c', schema], 'Set up FK and authorization fixture');
for (const name of [
  'suppliers','supplier_inventory_items','purchase_orders','purchase_order_lines',
  'purchase_receipts','purchase_receipt_lines','purchase_returns','purchase_return_lines',
  'supplier_price_history',
]) {
  command(['-c', extract('create table public.' + name + ' (', '\n);')],
    'Real Purchasing table ' + name);
}
for (const name of [
  'private.admin_purchasing_authority_v1',
  'public.receive_purchase_order_v1',
  'public.return_purchase_order_v1',
]) {
  command(['-c', extract('create or replace function ' + name + '(', '\n$$;')],
    'Real Purchasing RPC ' + name);
}

// Execute the new additive replay remediation AFTER the original Purchasing
// functions are installed; RED on original SQL, GREEN on the exact migration.
command(['-f', 'supabase/migrations/20261027190000_inventory_purchasing_replay_payload_integrity.sql'],
  'Apply I3 Purchasing replay integrity migration to disposable PostgreSQL');

const business = '10000000-0000-4000-8000-000000000001';
const shop = '20000000-0000-4000-8000-000000000001';
const foreign = '20000000-0000-4000-8000-000000000003';
const employee = '30000000-0000-4000-8000-000000000001';
const outsider = '30000000-0000-4000-8000-000000000002';
const item = '50000000-0000-4000-8000-000000000001';
const supplier = '60000000-0000-4000-8000-000000000001';
const po = '61000000-0000-4000-8000-000000000001';
const line = '62000000-0000-4000-8000-000000000001';
sql('insert into public.suppliers(id,business_id,name,created_by_employee_id,create_command_id) values(' +
  [supplier,business,'I3 supplier',employee,'create-supplier'].map(q).join(',') + ')');
sql('insert into public.purchase_orders(id,business_id,shop_id,supplier_id,status,created_by_employee_id,ordered_at,create_command_id) values(' +
  [po,business,shop,supplier,'ORDERED',employee].map(q).join(',') + ",now(),'create-po')");
sql('insert into public.purchase_order_lines(id,purchase_order_id,inventory_item_id,purchase_unit_label,base_micros_per_purchase_unit,ordered_purchase_units_micros,ordered_base_micros,expected_purchase_unit_cost_minor,expected_unit_cost_minor) values(' +
  [line,po,item,'case',3000000,2000000,6000000,3000,1000].map(q).join(',') + ')');

function balance(shopId = shop) {
  return Number(sql('select on_hand_micros from private.inventory_balance_v1(' +
    [shopId,item].map(q).join(',') + ')'));
}
function unitCost() {
  return Number(sql('select weighted_unit_cost_minor from public.inventory_cost_state where shop_id=' +
    q(shop) + ' and inventory_item_id=' + q(item)));
}
function movementCount(cmd,kind) {
  return Number(sql('select count(*) from public.inventory_movements where shop_id=' +
    q(shop) + ' and command_id=' + q(cmd) + ' and movement_type=' + q(kind)));
}
const before = balance();
const beforeCost = unitCost();
const receiptLines = [{lineId:line,receivedPurchaseUnitsMicros:1000000,purchaseUnitCostMinor:3000}];
const receive = [employee,shop,po,'i3-receive','supplier-ref',receiptLines];
const receipt = call('receive_purchase_order_v1',receive);
check(receipt.ok && !receipt.idempotentReplay, 'Receipt must post original command');
equal(receipt.status,'PARTIALLY_RECEIVED','Partial receipt status');
equal(balance(),before+3000000,'Receipt credits exactly 3 base units');
equal(movementCount('i3-receive','PURCHASE_RECEIPT'),1,'One receipt movement');
const weighted = (before * beforeCost + 3000000 * 1000)/(before+3000000);
check(Math.abs(unitCost()-weighted)<0.000002,'Weighted stock unit cost updated');
const repeatedReceipt = call('receive_purchase_order_v1',receive);
check(repeatedReceipt.ok && repeatedReceipt.idempotentReplay &&
  repeatedReceipt.receiptId===receipt.receiptId, 'Exact receipt retry replays');
equal(balance(),before+3000000,'No double receive');
const changedReceive=[...receive];
changedReceive[5]=[{...receiptLines[0],receivedPurchaseUnitsMicros:2000000}];
equal(call('receive_purchase_order_v1',changedReceive).code,'idempotency_conflict',
  'Altered receive replay must be rejected');

const tooMuch = call('return_purchase_order_v1',
  [employee,shop,po,'i3-too-much',null,[{lineId:line,returnedPurchaseUnitsMicros:2000000}]]);
equal(tooMuch.code,'return_exceeds_received','Cannot return unreceived units');
const returnLines=[{lineId:line,returnedPurchaseUnitsMicros:1000000}];
const ret=[employee,shop,po,'i3-return',null,returnLines];
const returned=call('return_purchase_order_v1',ret);
check(returned.ok&&!returned.idempotentReplay,'Return posts');
equal(balance(),before,'Return reverses 3 base units');
equal(movementCount('i3-return','PURCHASE_RETURN'),1,'One return movement');
check(Number.isFinite(unitCost())&&unitCost()>=0,'Return weighted cost finite');
const repeatedReturn=call('return_purchase_order_v1',ret);
check(repeatedReturn.ok&&repeatedReturn.idempotentReplay &&
  repeatedReturn.returnId===returned.returnId,'Exact return retry replays');
equal(balance(),before,'Return retry no double debit');
const changedReturn=[...ret];
changedReturn[5]=[{...returnLines[0],returnedPurchaseUnitsMicros:2000000}];
equal(call('return_purchase_order_v1',changedReturn).code,'idempotency_conflict',
  'Altered return replay must be rejected');

equal(balance(foreign),0,'Foreign shop not credited');
command(['-c','select public.receive_purchase_order_v1(' +
  [outsider,shop,po,'i3-unauthorized',null,receiptLines].map(q).join(',') + ')'],
  'Foreign employee denied even before replay',true,'TUX_ADMIN_PURCHASING_PERMISSION_REQUIRED');
console.log('I3 bridge: real Purchasing receipt/return and isolated Inventory ledger/cost PASS');

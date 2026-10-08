import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Plan 7 materialization PostgreSQL requires TEST_DATABASE_URL');
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Plan 7 PostgreSQL test refuses non-loopback databases');
}
function run(sql, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed: ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}
function read(sql, label) {
  return run(sql, label);
}
const b = '11000000-0000-4000-8000-000000000001';
const s = '12000000-0000-4000-8000-000000000001';
const e = '13000000-0000-4000-8000-000000000001';
const w = '14000000-0000-4000-8000-000000000001';
const d = '15000000-0000-4000-8000-000000000001';
const a = '16000000-0000-4000-8000-000000000001';
const a2 = '16000000-0000-4000-8000-000000000002';
const orderType = '17000000-0000-4000-8000-000000000001';
const method = '18000000-0000-4000-8000-000000000001';
const method2 = '18000000-0000-4000-8000-000000000002';
const o1 = '19000000-0000-4000-8000-000000000001';
const o2 = '19000000-0000-4000-8000-000000000002';
const p1 = '20000000-0000-4000-8000-000000000001';
const p2 = '20000000-0000-4000-8000-000000000002';
const p3 = '20000000-0000-4000-8000-000000000003';
const reason = '21000000-0000-4000-8000-000000000001';
const r1 = '22000000-0000-4000-8000-000000000001';
const r2 = '22000000-0000-4000-8000-000000000002';

run(`
  drop schema if exists public cascade; create schema public;
  drop schema if exists private cascade; create schema private;
  drop schema if exists auth cascade; create schema auth;
  drop schema if exists storage cascade; create schema storage;
  create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false);
  do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
  end $$;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`, 'isolation reset');

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const target = '20261008060000_admin_plan7_payment_materialization.sql';
assert(migrations.includes(target), 'materialization migration missing');
for (const name of migrations.slice(0, migrations.indexOf(target) + 1)) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`migration failed: ${name}`);
  }
}

run(`
  insert into public.businesses(id,name) values ('${b}','Sale attribution business');
  insert into public.shops(id,name,active) values ('${s}','Test shop',true);
  insert into public.business_shops(business_id,shop_id) values ('${b}','${s}');
  insert into public.business_employees(id,business_id,display_name,role,active)
    values ('${e}','${b}','Admin reviewer','OWNER',true);
  insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
    values ('${b}','${e}','${s}');
  insert into public.workers(id,shop_id,display_name,pin_hash,active)
    values ('${w}','${s}','Real cashier','test-worker-credential',true);
  insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id)
    values ('${d}','${s}','OPEN',now() - interval '1 day','${w}');
  insert into public.order_types(id,shop_id,name,behavior,active,sort_order)
    values ('${orderType}','${s}','Takeaway','TAKE_AWAY',true,1);
  insert into public.payment_methods(id,shop_id,display_name,logic_type,requires_reconciliation,active,sort_order)
    values ('${method}','${s}','Cash first','CASH',false,true,1),
           ('${method2}','${s}','Cash second','CASH',false,true,2);
  insert into public.finance_accounts(id,business_id,shop_id,account_type,name,active,opening_balance_minor)
    values ('${a}','${b}','${s}','CASH','Till',true,0),
           ('${a2}','${b}','${s}','BANK','Bank',true,0);
  insert into public.admin_reason_codes(id,business_id,shop_id,reason_key,family,label,updated_by_employee_id)
    values ('${reason}','${b}','${s}','refund-test','REFUND_RETURN','Refund','${e}');
  insert into public.orders(
    id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,
    operator_worker_id,operator_name_snapshot,order_type_id,
    order_type_label_snapshot,order_type_behavior_snapshot,
    configured_delivery_fee_minor,final_delivery_fee_minor,
    items_subtotal_minor,discount_minor,total_minor,
    created_at,updated_at,operational_revision,service_charge_minor,tax_minor
  ) values (
    '${o1}','${s}','${d}',1,'order-one','POS','DONE',
    '${w}','Real cashier','${orderType}',
    'Takeaway','TAKE_AWAY',0,0,20000,0,20000,now(),now(),0,0,0
  ),(
    '${o2}','${s}','${d}',2,'order-two','POS','DONE',
    '${w}','Real cashier','${orderType}',
    'Takeaway','TAKE_AWAY',0,0,10000,0,10000,now(),now(),0,0,0
  );
`, 'canonical shop/order fixtures');

run(`
  insert into public.payments(
    id,shop_id,order_id,part_index,payment_method_id,payment_method_label_snapshot,
    logic_type_snapshot,allocated_minor,received_minor,change_minor,created_at
  ) values (
    '${p1}','${s}','${o1}',1,'${method}','Cash',
    'CASH',10000,20000,10000,now() - interval '1 minute'
  );
`, 'unmapped cash with change');
assert.equal(read("select count(*) from public.finance_movements", 'unmapped count'), '0');

run(`
  insert into public.payment_method_finance_accounts(
    business_id,shop_id,payment_method_id,finance_account_id,active
  ) values ('${b}','${s}','${method2}','${a}',true);
  insert into public.payments(
    id,shop_id,order_id,part_index,payment_method_id,payment_method_label_snapshot,
    logic_type_snapshot,allocated_minor,received_minor,change_minor,created_at
  ) values (
    '${p2}','${s}','${o1}',2,'${method2}','Cash second',
    'CASH',10000,15000,5000,now() + interval '1 second'
  );
`, 'explicit mapping and split cash change');
assert.equal(
  read(`select count(*) from public.finance_movements where source_kind='PAYMENT' and source_id='${p2}'`, 'SALE uniqueness'),
  '1',
);
assert.equal(
  read(`select amount_minor from public.finance_movements where source_id='${p2}'`, 'SALE allocated amount'),
  '10000',
);
assert.equal(
  read(`select actor_worker_id from public.finance_movements where source_id='${p2}'`, 'real worker'),
  w,
);
assert.equal(read(`select count(*) from public.finance_movements where source_id='${p1}'`, 'historical unmapped'), '0');

run(`
  insert into public.payment_method_finance_accounts(
    business_id,shop_id,payment_method_id,finance_account_id,active
  ) values ('${b}','${s}','${method}','${a}',true);
  insert into public.payments(
    id,shop_id,order_id,part_index,payment_method_id,payment_method_label_snapshot,
    logic_type_snapshot,allocated_minor,received_minor,change_minor,created_at
  ) values (
    '${p3}','${s}','${o2}',1,'${method}','Cash',
    'CASH',10000,10000,0,now() - interval '1 day'
  );
`, 'historical payment cannot retroactively inherit new mapping');
assert.equal(read(`select count(*) from public.finance_movements where source_id='${p3}'`, 'historical safety'), '0');

run(`
  insert into public.admin_order_refunds(
    id,business_id,shop_id,order_id,payment_id,amount_minor,
    reason_code_id,reason_code_key,reason_label_snapshot,reason_family_snapshot,
    reason_config_version,state,command_id,created_by_employee_id,created_at
  ) values (
    '${r1}','${b}','${s}','${o1}','${p2}',4000,
    '${reason}','refund-test','Refund','REFUND_RETURN',
    1,'PENDING_APPROVAL','refund-command-1','${e}',now()
  );
`, 'pending refund');
assert.equal(read(`select count(*) from public.finance_movements where source_id='${r1}'`, 'pending ignored'), '0');
run(`update public.admin_order_refunds set state='POSTED' where id='${r1}';`, 'POSTED refund');
assert.equal(
  read(`select amount_minor from public.finance_movements where source_kind='ADMIN_ORDER_REFUND' and source_id='${r1}'`, 'refund negative'),
  '-4000',
);
assert.equal(
  read(`select actor_employee_id from public.finance_movements where source_kind='ADMIN_ORDER_REFUND' and source_id='${r1}'`, 'refund actor'),
  e,
);

run(`
  update public.payment_method_finance_accounts
    set finance_account_id='${a2}', version=version+1, updated_at=now()
    where business_id='${b}' and shop_id='${s}' and payment_method_id='${method2}';
  insert into public.admin_order_refunds(
    id,business_id,shop_id,order_id,payment_id,amount_minor,
    reason_code_id,reason_code_key,reason_label_snapshot,reason_family_snapshot,
    reason_config_version,state,command_id,created_by_employee_id,created_at
  ) values (
    '${r2}','${b}','${s}','${o1}','${p2}',2000,
    '${reason}','refund-test','Refund','REFUND_RETURN',
    1,'POSTED','refund-command-2','${e}',now()
  );
`, 'historical refund remains on original account');
assert.equal(
  read(`select finance_account_id from public.finance_movements where source_kind='ADMIN_ORDER_REFUND' and source_id='${r2}'`, 'original attribution only'),
  a,
);
run(`update public.admin_order_refunds set state='POSTED' where id='${r1}';`, 'refund replay');
assert.equal(read(`select count(*) from public.finance_movements where source_kind='ADMIN_ORDER_REFUND' and source_id='${r1}'`, 'refund replay count'), '1');
assert.equal(read("select count(*) from public.finance_movements where movement_type='SALE'", 'SALE total count'), '1');
assert.equal(read("select count(*) from public.finance_movements where movement_type='REFUND'", 'POSTED total count'), '2');
console.log('Plan 7 trusted financial SALE/REFUND PostgreSQL behavior passed.');

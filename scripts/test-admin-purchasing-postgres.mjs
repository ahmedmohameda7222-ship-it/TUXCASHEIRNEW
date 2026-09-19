import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin purchasing PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin purchasing PostgreSQL test refuses non-loopback PostgreSQL.');
}

function psql(args, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.stdout;
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists private cascade;
     create schema private;
     drop schema if exists auth cascade;
     create schema auth;
     drop schema if exists storage cascade;
     create schema storage;
     create table storage.buckets (
       id text primary key,
       name text not null unique,
       public boolean not null default false
     );
     do $$
     begin
       if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit; end if;
     end $$;
     grant usage on schema public to anon, authenticated, service_role;
     create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
     $$;`,
  ],
  'Purchasing fixture reset',
);

const migrationName = '20260910150000_admin_purchasing.sql';
const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(migrationName);
if (targetIndex < 0) throw new Error('Admin purchasing migration missing from repository chain.');

for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '15000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '25000000-0000-4000-8000-000000000001';
const ITEM_ID = '35000000-0000-4000-8000-000000000001';
const SUPPLIER_ID = '45000000-0000-4000-8000-000000000001';
const PO_ID = '55000000-0000-4000-8000-000000000001';
const LINE_ID = '65000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values ('${SHOP_ID}', 'Purchasing Test Shop', true);
     insert into public.business_shops(business_id, shop_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}');
     insert into public.business_employees(
       id, business_id, display_name, role, active
     ) values (
       '${EMPLOYEE_ID}', '${BUSINESS_ID}', 'Purchasing Owner', 'OWNER', true
     );
     insert into public.inventory_items(
       id, shop_id, name, unit_label, tracking_mode, active
     ) values (
       '${ITEM_ID}', '${SHOP_ID}', 'Test Beef', 'g', 'RECIPE_TRACKED', true
     );
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       compensates_movement_id, idempotency_key, admin_employee_id,
       source_kind, command_id, unit_cost_minor, created_at
     ) values (
       '75000000-0000-4000-8000-000000000001',
       '${SHOP_ID}', null, '${ITEM_ID}', 'ADMIN_ADJUSTMENT',
       1000000, 0, null, null, null, 'purchasing-opening-stock',
       '${EMPLOYEE_ID}', 'ADMIN', 'purchasing-opening-stock', 100,
       timestamptz '2026-09-19 00:00:00+00'
     );
     insert into public.inventory_cost_state(
       shop_id, inventory_item_id, weighted_unit_cost_minor, version
     ) values ('${SHOP_ID}', '${ITEM_ID}', 100, 1);
     insert into public.suppliers(
       id, business_id, name, created_by_employee_id
     ) values (
       '${SUPPLIER_ID}', '${BUSINESS_ID}', 'Test Supplier', '${EMPLOYEE_ID}'
     );
     insert into public.purchase_orders(
       id, business_id, shop_id, supplier_id, status,
       reference, expected_delivery_date, version,
       created_by_employee_id, ordered_at, create_command_id, order_command_id
     ) values (
       '${PO_ID}', '${BUSINESS_ID}', '${SHOP_ID}', '${SUPPLIER_ID}', 'ORDERED',
       'PO-TEST-1', date '2026-09-22', 2,
       '${EMPLOYEE_ID}', timestamptz '2026-09-19 00:05:00+00',
       'create-po-test', 'order-po-test'
     );
     insert into public.purchase_order_lines(
       id, purchase_order_id, inventory_item_id, purchase_unit_label,
       ordered_base_micros, expected_unit_cost_minor
     ) values (
       '${LINE_ID}', '${PO_ID}', '${ITEM_ID}', 'kg', 1000000, 180
     );`,
  ],
  'Purchasing fixture seed',
);

const before = psql(
  [
    '-At',
    '-c',
    `select on_hand_micros || ':' || reserved_micros || ':' || available_micros
     from private.inventory_balance_v1('${SHOP_ID}', '${ITEM_ID}')`,
  ],
  'Purchasing balance before receiving',
).trim();
if (before !== '1000000:0:1000000') {
  throw new Error(`unexpected opening inventory balance: ${before}`);
}

const partialResult = psql(
  [
    '-At',
    '-c',
    `select public.receive_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${PO_ID}',
       'receive-partial-1',
       'INV-1001',
       '[{"lineId":"${LINE_ID}","receivedBaseMicros":500000,"unitCostMinor":200}]'::jsonb
     )::text`,
  ],
  'Partial purchase receipt',
).trim();
const partial = JSON.parse(partialResult);
if (
  partial.ok !== true ||
  partial.status !== 'PARTIALLY_RECEIVED' ||
  partial.version !== 3 ||
  partial.idempotentReplay !== false
) {
  throw new Error(`unexpected partial receipt result: ${partialResult}`);
}

psql(
  [
    '-c',
    `do $$
     declare
       v_on_hand bigint;
       v_reserved bigint;
       v_available bigint;
       v_cost numeric(20, 6);
     begin
       select b.on_hand_micros, b.reserved_micros, b.available_micros
         into v_on_hand, v_reserved, v_available
       from private.inventory_balance_v1('${SHOP_ID}', '${ITEM_ID}') b;
       if v_on_hand <> 1500000 or v_reserved <> 0 or v_available <> 1500000 then
         raise exception 'partial receipt inventory mismatch: %, %, %',
           v_on_hand, v_reserved, v_available;
       end if;

       select weighted_unit_cost_minor into v_cost
       from public.inventory_cost_state
       where shop_id = '${SHOP_ID}' and inventory_item_id = '${ITEM_ID}';
       if v_cost <> 133.333333 then
         raise exception 'weighted average cost mismatch: %', v_cost;
       end if;

       if not exists (
         select 1
         from public.purchase_orders po
         join public.purchase_order_lines pol on pol.purchase_order_id = po.id
         where po.id = '${PO_ID}'
           and po.status = 'PARTIALLY_RECEIVED'
           and po.version = 3
           and pol.id = '${LINE_ID}'
           and pol.ordered_base_micros = 1000000
           and pol.received_base_micros = 500000
           and pol.ordered_base_micros - pol.received_base_micros = 500000
       ) then
         raise exception 'partial receipt incorrectly completed PO remainder';
       end if;

       if not exists (
         select 1
         from public.purchase_receipts r
         join public.purchase_receipt_lines rl on rl.purchase_receipt_id = r.id
         where r.purchase_order_id = '${PO_ID}'
           and r.command_id = 'receive-partial-1'
           and r.supplier_reference = 'INV-1001'
           and rl.purchase_order_line_id = '${LINE_ID}'
           and rl.received_base_micros = 500000
           and rl.unit_cost_minor = 200
       ) then
         raise exception 'receipt header/line missing';
       end if;

       if not exists (
         select 1 from public.inventory_movements
         where shop_id = '${SHOP_ID}'
           and inventory_item_id = '${ITEM_ID}'
           and movement_type = 'PURCHASE_RECEIPT'
           and quantity_delta_micros = 500000
           and command_id = 'receive-partial-1'
           and unit_cost_minor = 200
       ) then
         raise exception 'purchase receipt movement missing';
       end if;

       if not exists (
         select 1 from public.supplier_price_history
         where supplier_id = '${SUPPLIER_ID}'
           and inventory_item_id = '${ITEM_ID}'
           and purchase_order_id = '${PO_ID}'
           and source_kind = 'RECEIPT'
           and unit_cost_minor = 200
       ) then
         raise exception 'supplier price history missing';
       end if;

       if not exists (
         select 1 from public.admin_audit_events
         where shop_id = '${SHOP_ID}'
           and actor_employee_id = '${EMPLOYEE_ID}'
           and action_type = 'PURCHASING_PO_RECEIVED'
           and entity_id = '${PO_ID}'
       ) then
         raise exception 'purchase receiving audit event missing';
       end if;
     end $$;`,
  ],
  'Partial receipt transactional assertions',
);

const replay = psql(
  [
    '-At',
    '-c',
    `select public.receive_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${PO_ID}',
       'receive-partial-1',
       'INV-1001',
       '[{"lineId":"${LINE_ID}","receivedBaseMicros":500000,"unitCostMinor":200}]'::jsonb
     )::text`,
  ],
  'Partial purchase receipt replay',
).trim();
if (JSON.parse(replay).idempotentReplay !== true) {
  throw new Error(`purchase receipt replay was not idempotent: ${replay}`);
}

const completeResult = psql(
  [
    '-At',
    '-c',
    `select public.receive_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${PO_ID}',
       'receive-complete-2',
       'INV-1002',
       '[{"lineId":"${LINE_ID}","receivedBaseMicros":500000,"unitCostMinor":300}]'::jsonb
     )::text`,
  ],
  'Complete purchase receipt',
).trim();
const complete = JSON.parse(completeResult);
if (complete.ok !== true || complete.status !== 'RECEIVED' || complete.version !== 4) {
  throw new Error(`unexpected complete receipt result: ${completeResult}`);
}

const returnResult = psql(
  [
    '-At',
    '-c',
    `select public.return_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${PO_ID}',
       'return-1',
       'CN-1001',
       '[{"lineId":"${LINE_ID}","returnedBaseMicros":250000,"unitCostMinor":300}]'::jsonb
     )::text`,
  ],
  'Purchase return',
).trim();
const returned = JSON.parse(returnResult);
if (
  returned.ok !== true ||
  returned.status !== 'RECEIVED' ||
  returned.version !== 5 ||
  returned.idempotentReplay !== false
) {
  throw new Error(`unexpected purchase return result: ${returnResult}`);
}

psql(
  [
    '-c',
    `do $$
     declare
       v_on_hand bigint;
       v_reserved bigint;
       v_available bigint;
       v_cost numeric(20, 6);
     begin
       select b.on_hand_micros, b.reserved_micros, b.available_micros
         into v_on_hand, v_reserved, v_available
       from private.inventory_balance_v1('${SHOP_ID}', '${ITEM_ID}') b;
       if v_on_hand <> 1750000 or v_reserved <> 0 or v_available <> 1750000 then
         raise exception 'purchase return inventory mismatch: %, %, %',
           v_on_hand, v_reserved, v_available;
       end if;

       select weighted_unit_cost_minor into v_cost
       from public.inventory_cost_state
       where shop_id = '${SHOP_ID}' and inventory_item_id = '${ITEM_ID}';
       if v_cost <> 157.142857 then
         raise exception 'purchase return weighted cost mismatch: %', v_cost;
       end if;

       if not exists (
         select 1 from public.purchase_order_lines
         where id = '${LINE_ID}'
           and received_base_micros = 1000000
           and returned_base_micros = 250000
       ) then
         raise exception 'purchase return did not update line returned quantity';
       end if;

       if not exists (
         select 1
         from public.purchase_returns r
         join public.purchase_return_lines rl on rl.purchase_return_id = r.id
         where r.purchase_order_id = '${PO_ID}'
           and r.command_id = 'return-1'
           and r.supplier_reference = 'CN-1001'
           and rl.purchase_order_line_id = '${LINE_ID}'
           and rl.returned_base_micros = 250000
       ) then
         raise exception 'purchase return record missing';
       end if;

       if not exists (
         select 1 from public.inventory_movements
         where movement_type = 'PURCHASE_RETURN'
           and inventory_item_id = '${ITEM_ID}'
           and quantity_delta_micros = -250000
           and command_id = 'return-1'
       ) then
         raise exception 'purchase return inventory movement missing';
       end if;

       if not exists (
         select 1 from public.admin_audit_events
         where action_type = 'PURCHASING_PO_RETURNED'
           and entity_id = '${PO_ID}'
       ) then
         raise exception 'purchase return audit event missing';
       end if;
     end $$;`,
  ],
  'Purchase return transactional assertions',
);

console.log('Admin purchasing PostgreSQL partial-receipt/return behavior passed.');

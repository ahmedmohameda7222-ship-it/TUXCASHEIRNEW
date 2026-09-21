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
const SECOND_PO_ID = '55000000-0000-4000-8000-000000000099';

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
     insert into public.inventory_unit_conversions(
       shop_id, inventory_item_id, purchase_unit_label, base_micros_per_purchase_unit, active
     ) values (
       '${SHOP_ID}', '${ITEM_ID}', 'kg', 1000000000, true
     );
     insert into public.purchase_order_lines(
       id, purchase_order_id, inventory_item_id, purchase_unit_label,
       base_micros_per_purchase_unit, ordered_purchase_units_micros,
       ordered_base_micros, expected_purchase_unit_cost_minor, expected_unit_cost_minor
     ) values (
       '${LINE_ID}', '${PO_ID}', '${ITEM_ID}', 'kg',
       1000000000, 1000, 1000000, 180000, 180
     );
     insert into public.purchase_orders(
       id, business_id, shop_id, supplier_id, status,
       reference, expected_delivery_date, version,
       created_by_employee_id, ordered_at, create_command_id, order_command_id
     ) values (
       '${SECOND_PO_ID}', '${BUSINESS_ID}', '${SHOP_ID}', '${SUPPLIER_ID}', 'ORDERED',
       'PO-TEST-SECOND', date '2026-09-23', 7,
       '${EMPLOYEE_ID}', timestamptz '2026-09-19 00:06:00+00',
       'create-po-second', 'order-po-second'
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
       '[{"lineId":"${LINE_ID}","receivedPurchaseUnitsMicros":500,"purchaseUnitCostMinor":200000}]'::jsonb
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
           and base_micros_per_purchase_unit = 1000000000
           and purchase_unit_cost_minor = 200000
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
       '[{"lineId":"${LINE_ID}","receivedPurchaseUnitsMicros":500,"purchaseUnitCostMinor":200000}]'::jsonb
     )::text`,
  ],
  'Partial purchase receipt replay',
).trim();
if (JSON.parse(replay).idempotentReplay !== true) {
  throw new Error(`purchase receipt replay was not idempotent: ${replay}`);
}

const reusedReceive = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select public.receive_purchase_order_v1(
         '${EMPLOYEE_ID}',
         '${SHOP_ID}',
         '${SECOND_PO_ID}',
         'receive-partial-1',
         'INV-REUSED',
         '[{"lineId":"${LINE_ID}","receivedPurchaseUnitsMicros":500,"purchaseUnitCostMinor":200000}]'::jsonb
       )::text`,
    ],
    'Purchase receipt command reuse',
  ).trim(),
);
if (reusedReceive.ok !== false || reusedReceive.code !== 'idempotency_conflict') {
  throw new Error(
    `purchase receipt command was not bound to its original PO: ${JSON.stringify(reusedReceive)}`,
  );
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
       '[{"lineId":"${LINE_ID}","receivedPurchaseUnitsMicros":500,"purchaseUnitCostMinor":300000}]'::jsonb
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
       '[{"lineId":"${LINE_ID}","returnedPurchaseUnitsMicros":250}]'::jsonb
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

const returnReplay = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select public.return_purchase_order_v1(
         '${EMPLOYEE_ID}',
         '${SHOP_ID}',
         '${PO_ID}',
         'return-1',
         'CN-1001',
         '[{"lineId":"${LINE_ID}","returnedPurchaseUnitsMicros":250}]'::jsonb
       )::text`,
    ],
    'Purchase return replay',
  ).trim(),
);
if (returnReplay.idempotentReplay !== true) {
  throw new Error(`purchase return replay was not idempotent: ${JSON.stringify(returnReplay)}`);
}

const reusedReturn = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select public.return_purchase_order_v1(
         '${EMPLOYEE_ID}',
         '${SHOP_ID}',
         '${SECOND_PO_ID}',
         'return-1',
         'CN-REUSED',
         '[{"lineId":"${LINE_ID}","returnedPurchaseUnitsMicros":250}]'::jsonb
       )::text`,
    ],
    'Purchase return command reuse',
  ).trim(),
);
if (reusedReturn.ok !== false || reusedReturn.code !== 'idempotency_conflict') {
  throw new Error(
    `purchase return command was not bound to its original PO: ${JSON.stringify(reusedReturn)}`,
  );
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
           and received_purchase_units_micros = 1000
           and returned_purchase_units_micros = 250
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
           and rl.returned_purchase_units_micros = 250
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


const VARIANCE_ITEM_ID = '35000000-0000-4000-8000-000000000002';
const VARIANCE_PO_ID = '55000000-0000-4000-8000-000000000002';
const VARIANCE_LINE_ID = '65000000-0000-4000-8000-000000000002';
const VARIANCE_RECEIPT_ID = '85000000-0000-4000-8000-000000000002';
const VARIANCE_RECEIPT_LINE_ID = '95000000-0000-4000-8000-000000000002';

psql(
  [
    '-c',
    `insert into public.inventory_items(
       id, shop_id, name, unit_label, tracking_mode, active
     ) values (
       '${VARIANCE_ITEM_ID}', '${SHOP_ID}', 'Variance Test Item', 'ea', 'RECIPE_TRACKED', true
     );
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       compensates_movement_id, idempotency_key, admin_employee_id,
       source_kind, command_id, unit_cost_minor, created_at
     ) values (
       '75000000-0000-4000-8000-000000000002',
       '${SHOP_ID}', null, '${VARIANCE_ITEM_ID}', 'ADMIN_ADJUSTMENT',
       10000000, 0, null, null, null, 'variance-opening-stock',
       '${EMPLOYEE_ID}', 'ADMIN', 'variance-opening-stock', 150,
       timestamptz '2026-09-19 02:00:00+00'
     );
     insert into public.inventory_cost_state(
       shop_id, inventory_item_id, weighted_unit_cost_minor, version
     ) values ('${SHOP_ID}', '${VARIANCE_ITEM_ID}', 150, 1);
     insert into public.purchase_orders(
       id, business_id, shop_id, supplier_id, status, reference, version,
       created_by_employee_id, ordered_at, create_command_id, order_command_id
     ) values (
       '${VARIANCE_PO_ID}', '${BUSINESS_ID}', '${SHOP_ID}', '${SUPPLIER_ID}', 'RECEIVED',
       'PO-VARIANCE', 4, '${EMPLOYEE_ID}', timestamptz '2026-09-19 01:00:00+00',
       'create-po-variance', 'order-po-variance'
     );
     insert into public.purchase_order_lines(
       id, purchase_order_id, inventory_item_id, purchase_unit_label,
       base_micros_per_purchase_unit, ordered_purchase_units_micros,
       received_purchase_units_micros, ordered_base_micros, received_base_micros,
       expected_purchase_unit_cost_minor, expected_unit_cost_minor
     ) values (
       '${VARIANCE_LINE_ID}', '${VARIANCE_PO_ID}', '${VARIANCE_ITEM_ID}', 'ea',
       1000000, 10000000, 10000000, 10000000, 10000000, 200, 200
     );
     insert into public.purchase_receipts(
       id, purchase_order_id, shop_id, supplier_id, supplier_reference,
       command_id, received_by_employee_id, received_at
     ) values (
       '${VARIANCE_RECEIPT_ID}', '${VARIANCE_PO_ID}', '${SHOP_ID}', '${SUPPLIER_ID}',
       'INV-VARIANCE', 'receive-variance', '${EMPLOYEE_ID}',
       timestamptz '2026-09-19 01:30:00+00'
     );
     insert into public.purchase_receipt_lines(
       id, purchase_receipt_id, purchase_order_line_id, inventory_item_id,
       received_purchase_units_micros, received_base_micros,
       purchase_unit_cost_minor, unit_cost_minor
     ) values (
       '${VARIANCE_RECEIPT_LINE_ID}', '${VARIANCE_RECEIPT_ID}', '${VARIANCE_LINE_ID}',
       '${VARIANCE_ITEM_ID}', 10000000, 10000000, 200, 200
     );`,
  ],
  'Purchase return variance fixture',
);

const varianceReturnResult = psql(
  [
    '-At',
    '-c',
    `select public.return_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${VARIANCE_PO_ID}',
       'return-variance',
       'CN-VARIANCE',
       '[{"lineId":"${VARIANCE_LINE_ID}","returnedPurchaseUnitsMicros":10000000}]'::jsonb
     )::text`,
  ],
  'Purchase return after intervening weighted-average consumption',
).trim();
const varianceReturn = JSON.parse(varianceReturnResult);
if (varianceReturn.ok !== true) {
  throw new Error(`purchase return with price variance was rejected: ${varianceReturnResult}`);
}

psql(
  [
    '-c',
    `do $purchase_variance_assertions$
     declare
       v_on_hand bigint;
       v_cost numeric(20, 6);
       v_variance numeric(20, 6);
     begin
       select b.on_hand_micros into v_on_hand
       from private.inventory_balance_v1('${SHOP_ID}', '${VARIANCE_ITEM_ID}') b;
       if v_on_hand <> 0 then
         raise exception 'variance return did not remove returned stock: %', v_on_hand;
       end if;

       select weighted_unit_cost_minor into v_cost
       from public.inventory_cost_state
       where shop_id = '${SHOP_ID}' and inventory_item_id = '${VARIANCE_ITEM_ID}';
       if v_cost <> 0 then
         raise exception 'variance return did not zero exhausted inventory cost: %', v_cost;
       end if;

       select purchase_price_variance_minor into v_variance
       from public.purchase_returns
       where shop_id = '${SHOP_ID}' and command_id = 'return-variance';
       if v_variance <> 500 then
         raise exception 'unexpected purchase price variance: %', v_variance;
       end if;
     end $purchase_variance_assertions$;`,
  ],
  'Purchase return price-variance assertions',
);


const COST_WORKER_ID = '26000000-0000-4000-8000-000000000001';
const COST_MOVEMENT_ID = '76000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.workers(id, shop_id, display_name, pin_hash, active)
     values ('${COST_WORKER_ID}', '${SHOP_ID}', 'Cost Worker', 'test-hash', true)
     on conflict (id) do nothing;
     insert into public.inventory_cost_state(
       shop_id, inventory_item_id, weighted_unit_cost_minor, version
     ) values ('${SHOP_ID}', '${ITEM_ID}', 777, 1)
     on conflict (shop_id, inventory_item_id) do update
     set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
         version = public.inventory_cost_state.version + 1,
         updated_at = now();
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       compensates_movement_id, idempotency_key, source_kind, command_id,
       unit_cost_minor, created_at
     ) values (
       '${COST_MOVEMENT_ID}', '${SHOP_ID}', null, '${ITEM_ID}', 'ORDER_CONSUMPTION',
       -1000, 0, '${COST_WORKER_ID}', null,
       null, 'canonical-cost-snapshot', 'OPERATIONS', 'canonical-cost-snapshot',
       111, timestamptz '2026-09-19 03:00:00+00'
     );`,
  ],
  'Canonical consumption cost fixture',
);

const canonicalConsumptionCost = Number(
  psql(
    [
      '-At',
      '-c',
      `select unit_cost_minor::text
       from public.inventory_movements
       where id = '${COST_MOVEMENT_ID}'`,
    ],
    'Canonical consumption cost snapshot assertion',
  ).trim(),
);
if (canonicalConsumptionCost !== 777) {
  throw new Error(
    `canonical ORDER_CONSUMPTION must snapshot locked cost 777, got ${canonicalConsumptionCost}`,
  );
}


const CHEAP_VARIANCE_ITEM_ID = '35000000-0000-4000-8000-000000000003';
const CHEAP_VARIANCE_PO_ID = '55000000-0000-4000-8000-000000000003';
const CHEAP_VARIANCE_LINE_ID = '65000000-0000-4000-8000-000000000003';
const CHEAP_VARIANCE_RECEIPT_ID = '85000000-0000-4000-8000-000000000003';
const CHEAP_VARIANCE_RECEIPT_LINE_ID = '95000000-0000-4000-8000-000000000003';

psql(
  [
    '-c',
    `insert into public.inventory_items(
       id, shop_id, name, unit_label, tracking_mode, active
     ) values (
       '${CHEAP_VARIANCE_ITEM_ID}', '${SHOP_ID}', 'Cheap Variance Item', 'ea', 'RECIPE_TRACKED', true
     );
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       compensates_movement_id, idempotency_key, admin_employee_id,
       source_kind, command_id, unit_cost_minor, created_at
     ) values (
       '75000000-0000-4000-8000-000000000003',
       '${SHOP_ID}', null, '${CHEAP_VARIANCE_ITEM_ID}', 'ADMIN_ADJUSTMENT',
       10000000, 0, null, null, null, 'cheap-variance-opening-stock',
       '${EMPLOYEE_ID}', 'ADMIN', 'cheap-variance-opening-stock', 150,
       timestamptz '2026-09-19 04:00:00+00'
     );
     insert into public.inventory_cost_state(
       shop_id, inventory_item_id, weighted_unit_cost_minor, version
     ) values ('${SHOP_ID}', '${CHEAP_VARIANCE_ITEM_ID}', 150, 1);
     insert into public.purchase_orders(
       id, business_id, shop_id, supplier_id, status, reference, version,
       created_by_employee_id, ordered_at, create_command_id, order_command_id
     ) values (
       '${CHEAP_VARIANCE_PO_ID}', '${BUSINESS_ID}', '${SHOP_ID}', '${SUPPLIER_ID}', 'RECEIVED',
       'PO-CHEAP-VARIANCE', 4, '${EMPLOYEE_ID}', timestamptz '2026-09-19 03:00:00+00',
       'create-po-cheap-variance', 'order-po-cheap-variance'
     );
     insert into public.purchase_order_lines(
       id, purchase_order_id, inventory_item_id, purchase_unit_label,
       base_micros_per_purchase_unit, ordered_purchase_units_micros,
       received_purchase_units_micros, ordered_base_micros, received_base_micros,
       expected_purchase_unit_cost_minor, expected_unit_cost_minor
     ) values (
       '${CHEAP_VARIANCE_LINE_ID}', '${CHEAP_VARIANCE_PO_ID}', '${CHEAP_VARIANCE_ITEM_ID}', 'ea',
       1000000, 10000000, 10000000, 10000000, 10000000, 100, 100
     );
     insert into public.purchase_receipts(
       id, purchase_order_id, shop_id, supplier_id, supplier_reference,
       command_id, received_by_employee_id, received_at
     ) values (
       '${CHEAP_VARIANCE_RECEIPT_ID}', '${CHEAP_VARIANCE_PO_ID}', '${SHOP_ID}', '${SUPPLIER_ID}',
       'INV-CHEAP-VARIANCE', 'receive-cheap-variance', '${EMPLOYEE_ID}',
       timestamptz '2026-09-19 03:30:00+00'
     );
     insert into public.purchase_receipt_lines(
       id, purchase_receipt_id, purchase_order_line_id, inventory_item_id,
       received_purchase_units_micros, received_base_micros,
       purchase_unit_cost_minor, unit_cost_minor
     ) values (
       '${CHEAP_VARIANCE_RECEIPT_LINE_ID}', '${CHEAP_VARIANCE_RECEIPT_ID}', '${CHEAP_VARIANCE_LINE_ID}',
       '${CHEAP_VARIANCE_ITEM_ID}', 10000000, 10000000, 100, 100
     );`,
  ],
  'Cheaper purchase return variance fixture',
);

const cheapVarianceReturnResult = psql(
  [
    '-At',
    '-c',
    `select public.return_purchase_order_v1(
       '${EMPLOYEE_ID}',
       '${SHOP_ID}',
       '${CHEAP_VARIANCE_PO_ID}',
       'return-cheap-variance',
       'CN-CHEAP-VARIANCE',
       '[{"lineId":"${CHEAP_VARIANCE_LINE_ID}","returnedPurchaseUnitsMicros":10000000}]'::jsonb
     )::text`,
  ],
  'Cheaper purchase return that exhausts inventory',
).trim();
const cheapVarianceReturn = JSON.parse(cheapVarianceReturnResult);
if (cheapVarianceReturn.ok !== true) {
  throw new Error(`cheaper purchase return was rejected: ${cheapVarianceReturnResult}`);
}

psql(
  [
    '-c',
    `do $cheap_purchase_variance_assertions$
     declare
       v_on_hand bigint;
       v_cost numeric(20, 6);
       v_variance numeric(20, 6);
     begin
       select b.on_hand_micros into v_on_hand
       from private.inventory_balance_v1('${SHOP_ID}', '${CHEAP_VARIANCE_ITEM_ID}') b;
       if v_on_hand <> 0 then
         raise exception 'cheap variance return did not remove all stock: %', v_on_hand;
       end if;

       select weighted_unit_cost_minor into v_cost
       from public.inventory_cost_state
       where shop_id = '${SHOP_ID}' and inventory_item_id = '${CHEAP_VARIANCE_ITEM_ID}';
       if v_cost <> 0 then
         raise exception 'cheap variance return did not zero exhausted inventory cost: %', v_cost;
       end if;

       select purchase_price_variance_minor into v_variance
       from public.purchase_returns
       where shop_id = '${SHOP_ID}' and command_id = 'return-cheap-variance';
       if v_variance <> -500 then
         raise exception 'unexpected cheaper-return purchase price variance: %', v_variance;
       end if;
     end $cheap_purchase_variance_assertions$;`,
  ],
  'Cheaper purchase return variance assertions',
);

console.log('Admin purchasing PostgreSQL partial-receipt/return behavior passed.');

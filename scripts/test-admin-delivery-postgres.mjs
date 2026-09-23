import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin delivery PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin delivery PostgreSQL test refuses non-loopback PostgreSQL.');
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

function rpc(sql, label) {
  return JSON.parse(psql(['-At', '-c', `select (${sql})::text`], label).trim());
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
  'Delivery fixture reset',
);

const targetMigration = '20260910190000_admin_delivery.sql';
const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Admin delivery migration missing from repository chain.');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '81000000-0000-4000-8000-000000000001';
const OTHER_SHOP_ID = '81000000-0000-4000-8000-000000000002';
const EMPLOYEE_ID = '82000000-0000-4000-8000-000000000001';
const WORKER_ID = '83000000-0000-4000-8000-000000000001';
const DAY_ID = '84000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '85000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '86000000-0000-4000-8000-000000000001';
const ORDER_TYPE_ID = '87000000-0000-4000-8000-000000000001';
const ORDER_ID = '88000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values
         ('${SHOP_ID}', 'Delivery Test Shop', true),
         ('${OTHER_SHOP_ID}', 'Other Delivery Shop', true);
     insert into public.business_shops(business_id, shop_id)
       values
         ('${BUSINESS_ID}', '${SHOP_ID}'),
         ('${BUSINESS_ID}', '${OTHER_SHOP_ID}');
     insert into public.business_employees(id, business_id, display_name, role, active)
       values ('${EMPLOYEE_ID}', '${BUSINESS_ID}', 'Delivery Owner', 'OWNER', true);
     insert into public.workers(id, shop_id, display_name, pin_hash, active)
       values ('${WORKER_ID}', '${SHOP_ID}', 'Delivery Worker', 'test-only', true);
     insert into public.business_days(
       id, shop_id, status, started_at, ended_at, started_by_worker_id,
       ended_by_worker_id, last_allocated_display_order_no
     ) values (
       '${DAY_ID}', '${SHOP_ID}', 'OPEN', '2026-09-23T05:00:00Z',
       null, '${WORKER_ID}', null, 1
     );
     insert into public.menu_categories(id, shop_id, name, sort_order, active)
       values ('${CATEGORY_ID}', '${SHOP_ID}', 'Food', 0, true);
     insert into public.products(
       id, shop_id, category_id, name, price_minor, active, sold_out, is_combo, sort_order
     ) values (
       '${PRODUCT_ID}', '${SHOP_ID}', '${CATEGORY_ID}', 'Delivery Burger',
       5000, true, false, false, 0
     );
     insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
       values ('${ORDER_TYPE_ID}', '${SHOP_ID}', 'Delivery', 'DELIVERY', true, 0);
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values (
       '${ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 1, 'delivery-order-1', 'POS', 'DONE',
       '${WORKER_ID}', 'Delivery Worker', '${ORDER_TYPE_ID}', 'Delivery',
       'DELIVERY', null, null, null, 'Road 9, Maadi', null, null, 2500, 2500,
       5000, 0, 7500, null, '2026-09-23T05:10:00Z', '2026-09-23T05:10:00Z'
     );`,
  ],
  'Delivery fixture seed',
);

const rider = rpc(
  `public.upsert_admin_delivery_rider_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    null,
    'Primary Rider',
    '+201000000001',
    true,
    'AVAILABLE'
  )`,
  'Create primary rider',
);
if (rider.ok !== true || typeof rider.riderId !== 'string') {
  throw new Error(`primary rider creation failed: ${JSON.stringify(rider)}`);
}

const otherRider = rpc(
  `public.upsert_admin_delivery_rider_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${OTHER_SHOP_ID}'::uuid,
    null,
    null,
    'Other Rider',
    '+201000000002',
    true,
    'AVAILABLE'
  )`,
  'Create other-shop rider',
);
if (otherRider.ok !== true || typeof otherRider.riderId !== 'string') {
  throw new Error(`other rider creation failed: ${JSON.stringify(otherRider)}`);
}

const crossShop = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${otherRider.riderId}'::uuid,
    1,
    'ASSIGNED',
    null,
    'delivery-cross-shop-1'
  )`,
  'Reject cross-shop rider',
);
if (crossShop.ok !== false || crossShop.code !== 'rider_unavailable') {
  throw new Error(`cross-shop rider was accepted: ${JSON.stringify(crossShop)}`);
}

const assigned = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    1,
    'ASSIGNED',
    'Dispatch',
    'delivery-assign-1'
  )`,
  'Assign delivery',
);
if (assigned.ok !== true || assigned.state !== 'ASSIGNED' || Number(assigned.version) !== 2) {
  throw new Error(`delivery assignment failed: ${JSON.stringify(assigned)}`);
}

const assignedReplay = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    1,
    'ASSIGNED',
    'Dispatch',
    'delivery-assign-1'
  )`,
  'Replay delivery assignment',
);
if (assignedReplay.ok !== true || assignedReplay.replayed !== true) {
  throw new Error(`delivery assignment replay failed: ${JSON.stringify(assignedReplay)}`);
}

const commandConflict = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    null,
    2,
    'UNASSIGNED',
    'Changed payload',
    'delivery-assign-1'
  )`,
  'Delivery command conflict',
);
if (commandConflict.ok !== false || commandConflict.code !== 'delivery_command_conflict') {
  throw new Error(`changed delivery command payload did not conflict: ${JSON.stringify(commandConflict)}`);
}

const invalid = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    2,
    'DELIVERED',
    null,
    'delivery-invalid-1'
  )`,
  'Reject invalid delivery transition',
);
if (invalid.ok !== false || invalid.code !== 'invalid_delivery_transition') {
  throw new Error(`invalid delivery transition was accepted: ${JSON.stringify(invalid)}`);
}

const out = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    2,
    'OUT_FOR_DELIVERY',
    null,
    'delivery-out-1'
  )`,
  'Mark out for delivery',
);
if (out.ok !== true || out.state !== 'OUT_FOR_DELIVERY' || Number(out.version) !== 3) {
  throw new Error(`out-for-delivery transition failed: ${JSON.stringify(out)}`);
}

const prematureReturned = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    3,
    'RETURNED',
    'Customer rejected delivery',
    'delivery-return-1'
  )`,
  'Require canonical order return first',
);
if (prematureReturned.ok !== false || prematureReturned.code !== 'order_return_required') {
  throw new Error(
    `delivery RETURNED diverged from canonical order lifecycle: ${JSON.stringify(prematureReturned)}`,
  );
}

psql(
  [
    '-c',
    `update public.orders
     set status = 'RETURNED', operational_revision = operational_revision + 1
     where id = '${ORDER_ID}'::uuid;`,
  ],
  'Simulate canonical Operations delivery return',
);

const returned = rpc(
  `public.transition_admin_delivery_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${ORDER_ID}'::uuid,
    '${rider.riderId}'::uuid,
    3,
    'RETURNED',
    'Customer rejected delivery',
    'delivery-return-2'
  )`,
  'Converge dispatch state to canonical return',
);
if (returned.ok !== true || returned.state !== 'RETURNED' || Number(returned.version) !== 4) {
  throw new Error(`canonical returned delivery convergence failed: ${JSON.stringify(returned)}`);
}

const readback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'state', (select state from public.delivery_order_states where order_id = '${ORDER_ID}'::uuid),
         'riderId', (select rider_id from public.delivery_order_states where order_id = '${ORDER_ID}'::uuid),
         'orderStatus', (select status from public.orders where id = '${ORDER_ID}'::uuid),
         'eventCount', (
           select count(*) from public.delivery_order_state_events
           where order_id = '${ORDER_ID}'::uuid
         )
       )::text`,
    ],
    'Delivery state readback',
  ).trim(),
);
if (
  readback.state !== 'RETURNED' ||
  readback.riderId !== rider.riderId ||
  readback.orderStatus !== 'RETURNED' ||
  Number(readback.eventCount) !== 4
) {
  throw new Error(`delivery state history is invalid: ${JSON.stringify(readback)}`);
}

console.log('Admin delivery PostgreSQL behavior passed.');

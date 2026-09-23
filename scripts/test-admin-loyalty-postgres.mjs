import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin loyalty PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin loyalty PostgreSQL test refuses non-loopback PostgreSQL.');
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
  'Loyalty fixture reset',
);

const targetMigration = '20260910180000_admin_loyalty_promotions.sql';
const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Admin loyalty migration missing from repository chain.');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const SHOP_ID = '71000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '72000000-0000-4000-8000-000000000001';
const WORKER_ID = '73000000-0000-4000-8000-000000000001';
const DAY_ID = '74000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '75000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '76000000-0000-4000-8000-000000000001';
const FREE_PRODUCT_ID = '76000000-0000-4000-8000-000000000002';
const ORDER_TYPE_ID = '77000000-0000-4000-8000-000000000001';
const ORDER_ID = '78000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '79000000-0000-4000-8000-000000000001';
const REASON_ID = '7a000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values ('${SHOP_ID}', 'Loyalty Test Shop', true);
     insert into public.business_shops(business_id, shop_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}');
     insert into public.business_employees(id, business_id, display_name, role, active)
       values ('${EMPLOYEE_ID}', '${BUSINESS_ID}', 'Loyalty Owner', 'OWNER', true);
     insert into public.workers(id, shop_id, display_name, pin_hash, active)
       values ('${WORKER_ID}', '${SHOP_ID}', 'Loyalty Worker', 'test-only', true);
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
     ) values
       ('${PRODUCT_ID}', '${SHOP_ID}', '${CATEGORY_ID}', 'Reward Burger', 10000, true, false, false, 0),
       ('${FREE_PRODUCT_ID}', '${SHOP_ID}', '${CATEGORY_ID}', 'Reward Drink', 2000, true, false, false, 1);
     insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
       values ('${ORDER_TYPE_ID}', '${SHOP_ID}', 'Take Away', 'TAKE_AWAY', true, 0);
     insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values ('${CUSTOMER_ID}', '${BUSINESS_ID}', '+201000000009', 'Reward Customer');
     insert into public.customer_shop_links(business_id, shop_id, canonical_customer_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}');
     insert into public.admin_reason_codes(
       id, business_id, shop_id, reason_key, family, label, active, version, updated_by_employee_id
     ) values (
       '${REASON_ID}', '${BUSINESS_ID}', null, 'LOYALTY_SERVICE_RECOVERY',
       'DISCOUNT_COMP', 'Loyalty service recovery', true, 4, '${EMPLOYEE_ID}'
     );
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values (
       '${ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 1, 'loyalty-order-1', 'POS', 'DONE',
       '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away',
       'TAKE_AWAY', null, null, null, null, null, null, 0, 0,
       10000, 0, 10000, null, '2026-09-23T05:10:00Z', '2026-09-23T05:10:00Z'
     );`,
  ],
  'Loyalty fixture seed',
);

const program = rpc(
  `public.upsert_admin_loyalty_program_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    true,
    1,
    10,
    10,
    30,
    array['${SHOP_ID}'::uuid],
    null
  )`,
  'Loyalty program upsert',
);
if (program.ok !== true || Number(program.version) !== 1) {
  throw new Error(`loyalty program upsert failed: ${JSON.stringify(program)}`);
}

const adjustment = rpc(
  `public.adjust_admin_customer_loyalty_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CUSTOMER_ID}'::uuid,
    100,
    '${REASON_ID}'::uuid,
    'Recovery credit',
    'loyalty-adjust-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Loyalty manual adjustment',
);
if (adjustment.ok !== true || adjustment.replayed !== false || Number(adjustment.balance) !== 100) {
  throw new Error(`manual loyalty adjustment failed: ${JSON.stringify(adjustment)}`);
}

const adjustmentReplay = rpc(
  `public.adjust_admin_customer_loyalty_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CUSTOMER_ID}'::uuid,
    100,
    '${REASON_ID}'::uuid,
    'Recovery credit',
    'loyalty-adjust-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Loyalty adjustment replay',
);
if (
  adjustmentReplay.ok !== true ||
  adjustmentReplay.replayed !== true ||
  adjustmentReplay.ledgerEventId !== adjustment.ledgerEventId
) {
  throw new Error(`manual loyalty adjustment replay changed result: ${JSON.stringify(adjustmentReplay)}`);
}

const adjustmentConflict = rpc(
  `public.adjust_admin_customer_loyalty_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CUSTOMER_ID}'::uuid,
    99,
    '${REASON_ID}'::uuid,
    'Recovery credit',
    'loyalty-adjust-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Loyalty adjustment conflict',
);
if (adjustmentConflict.ok !== false || adjustmentConflict.code !== 'command_id_conflict') {
  throw new Error(`changed loyalty adjustment payload should conflict: ${JSON.stringify(adjustmentConflict)}`);
}

const promotion = rpc(
  `public.upsert_admin_promotion_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    'One use fixed',
    true,
    'FIXED',
    null,
    1000,
    null,
    '2026-09-20T00:00:00Z'::timestamptz,
    '2026-09-30T00:00:00Z'::timestamptz,
    5000,
    array['${SHOP_ID}'::uuid],
    'BOTH',
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    1,
    1,
    'ONE_ORDER_LEVEL',
    null,
    'promotion-upsert-1'
  )`,
  'Promotion upsert',
);
if (promotion.ok !== true || typeof promotion.promotionId !== 'string') {
  throw new Error(`promotion upsert failed: ${JSON.stringify(promotion)}`);
}

const reserved = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CUSTOMER_ID}'::uuid,
    'loyalty-checkout-1',
    '${promotion.promotionId}'::uuid,
    20,
    'POS',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T05:09:00Z'::timestamptz
  )`,
  'Reward reservation',
);
if (reserved.ok !== true || reserved.status !== 'RESERVED') {
  throw new Error(`reward reservation failed: ${JSON.stringify(reserved)}`);
}

const consumed = rpc(
  `public.consume_order_reward_reservation_v1(
    '${reserved.reservationId}'::uuid,
    '${ORDER_ID}'::uuid,
    '2026-09-23T05:10:00Z'::timestamptz
  )`,
  'Reward consume',
);
if (consumed.ok !== true || consumed.replayed !== false) {
  throw new Error(`reward consume failed: ${JSON.stringify(consumed)}`);
}

const consumedReplay = rpc(
  `public.consume_order_reward_reservation_v1(
    '${reserved.reservationId}'::uuid,
    '${ORDER_ID}'::uuid,
    '2026-09-23T05:11:00Z'::timestamptz
  )`,
  'Reward consume replay',
);
if (consumedReplay.ok !== true || consumedReplay.replayed !== true) {
  throw new Error(`reward consume replay failed: ${JSON.stringify(consumedReplay)}`);
}

const readback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'balance', (
           select coalesce(sum(points_delta), 0)
           from public.loyalty_ledger
           where business_id = '${BUSINESS_ID}'::uuid
             and customer_id = '${CUSTOMER_ID}'::uuid
         ),
         'manualCount', (
           select count(*) from public.loyalty_ledger
           where entry_key = 'admin-loyalty-adjust:loyalty-adjust-1'
         ),
         'earnCount', (
           select count(*) from public.loyalty_ledger
           where order_id = '${ORDER_ID}'::uuid and event_type = 'EARN'
         ),
         'redeemCount', (
           select count(*) from public.loyalty_ledger
           where order_id = '${ORDER_ID}'::uuid and event_type = 'REDEEM'
         ),
         'promotionCount', (
           select coalesce(sum(usage_delta), 0) from public.promotion_usage_ledger
           where order_id = '${ORDER_ID}'::uuid
         ),
         'rewardSnapshot', (
           select applied_reward_snapshot from public.orders where id = '${ORDER_ID}'::uuid
         ),
         'reasonKey', (
           select reason_code_key from public.loyalty_ledger
           where entry_key = 'admin-loyalty-adjust:loyalty-adjust-1'
         ),
         'reasonVersion', (
           select reason_config_version from public.loyalty_ledger
           where entry_key = 'admin-loyalty-adjust:loyalty-adjust-1'
         ),
         'auditCount', (
           select count(*) from public.admin_audit_events
           where action_type = 'LOYALTY_MANUAL_ADJUSTMENT'
             and entity_id = '${CUSTOMER_ID}'
         )
       )::text`,
    ],
    'Loyalty readback',
  ).trim(),
);

if (
  Number(readback.balance) !== 180 ||
  Number(readback.manualCount) !== 1 ||
  Number(readback.earnCount) !== 1 ||
  Number(readback.redeemCount) !== 1 ||
  Number(readback.promotionCount) !== 1 ||
  readback.rewardSnapshot === null ||
  readback.reasonKey !== 'LOYALTY_SERVICE_RECOVERY' ||
  Number(readback.reasonVersion) !== 4 ||
  Number(readback.auditCount) !== 1
) {
  throw new Error(`trusted loyalty finalization state is invalid: ${JSON.stringify(readback)}`);
}

console.log('Admin loyalty PostgreSQL behavior passed.');

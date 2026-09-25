import { spawn, spawnSync } from 'node:child_process';
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
function psqlAsync(args, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(
          new Error(
            `${label} failed with exit code ${code ?? 'unknown'}: ${stdout}\n${stderr}`,
          ),
        );
        return;
      }
      resolvePromise(stdout);
    });
  });
}

async function rpcAsync(sql, label) {
  const stdout = await psqlAsync(['-At', '-c', `select (${sql})::text`], label);
  return JSON.parse(stdout.trim());
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
const EXPIRY_CUSTOMER_ID = '79000000-0000-4000-8000-000000000002';
const ORDINARY_EARN_CUSTOMER_ID = '79000000-0000-4000-8000-000000000003';
const ORDINARY_EARN_ORDER_ID = '78000000-0000-4000-8000-000000000002';
const ORDINARY_EARN_CONTACT_ID = '7f000000-0000-4000-8000-000000000001';
const ORDINARY_EARN_ZONE_ID = '7f000000-0000-4000-8000-000000000002';
const DELIVERY_ORDER_TYPE_ID = '77000000-0000-4000-8000-000000000002';
const CANCELLATION_REASON_ID = '7a000000-0000-4000-8000-000000000002';
const REFUND_RETURN_REASON_ID = '7a000000-0000-4000-8000-000000000003';
const PAYMENT_METHOD_ID = '7b000000-0000-4000-8000-000000000001';
const CANCEL_ORDER_ID = '7c000000-0000-4000-8000-000000000001';
const REFUND_ORDER_ID = '7c000000-0000-4000-8000-000000000002';
const RETURN_ORDER_ID = '7c000000-0000-4000-8000-000000000003';
const REFUND_PAYMENT_ID = '7d000000-0000-4000-8000-000000000001';
const RETURN_ITEM_ID = '7e000000-0000-4000-8000-000000000001';
const RESERVED_ADJUSTMENT_CUSTOMER_ID = '79000000-0000-4000-8000-000000000004';
const CLAIMED_EXPIRY_CUSTOMER_ID = '79000000-0000-4000-8000-000000000005';

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
       '${ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 1, 'loyalty-checkout-1', 'POS', 'DONE',
       '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away',
       'TAKE_AWAY', null, null, null, null, null, null, 0, 0,
       10000, 1200, 8800, null, '2026-09-23T05:10:00Z', '2026-09-23T05:10:00Z'
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

psql(
  [
    '-c',
    `insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values (
         '${ORDINARY_EARN_CUSTOMER_ID}',
         '${BUSINESS_ID}',
         '+201000000007',
         'Ordinary Earn Customer'
       );
     insert into public.customer_shop_links(business_id, shop_id, canonical_customer_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}', '${ORDINARY_EARN_CUSTOMER_ID}');
     insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order)
       values ('${ORDINARY_EARN_ZONE_ID}', '${SHOP_ID}', 'Ordinary Earn Zone', 0, true, 10);
     insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
       values ('${DELIVERY_ORDER_TYPE_ID}', '${SHOP_ID}', 'Delivery', 'DELIVERY', true, 10);
     insert into public.customer_contacts(
       id, shop_id, normalized_phone, display_phone, name,
       latest_address, latest_zone_id, last_order_at, updated_at
     ) values (
       '${ORDINARY_EARN_CONTACT_ID}', '${SHOP_ID}', '+201000000007', '+201000000007',
       'Ordinary Earn Customer', 'Earn Street 1', '${ORDINARY_EARN_ZONE_ID}',
       '2026-09-23T05:12:00Z', '2026-09-23T05:12:00Z'
     );
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values (
       '${ORDINARY_EARN_ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 10,
       'loyalty-ordinary-earn-1', 'POS', 'ACTIVE',
       '${WORKER_ID}', 'Loyalty Worker', '${DELIVERY_ORDER_TYPE_ID}', 'Delivery',
       'DELIVERY', '${ORDINARY_EARN_CONTACT_ID}', 'Ordinary Earn Customer', '+201000000007',
       'Earn Street 1', '${ORDINARY_EARN_ZONE_ID}', 'Ordinary Earn Zone', 0, 0,
       10000, 0, 10000, null,
       '2026-09-23T05:12:00Z', '2026-09-23T05:12:00Z'
     );`,
  ],
  'Ordinary loyalty earn fixture',
);

const ordinaryEarn = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
        'points', coalesce(sum(l.points_delta), 0),
        'earnCount', count(*) filter (where l.event_type = 'EARN'),
        'entryKeys', coalesce(
          jsonb_agg(l.entry_key order by l.created_at, l.id) filter (where l.event_type = 'EARN'),
          '[]'::jsonb
        ),
        'contactCustomerId', (
          select canonical_customer_id
          from public.customer_contacts
          where id = '${ORDINARY_EARN_CONTACT_ID}'::uuid
        ),
        'phoneCustomerId', (
          select coalesce(merged_into_customer_id, id)
          from public.business_customers
          where business_id = '${BUSINESS_ID}'::uuid
            and normalized_phone = '+201000000007'
        ),
        'programEnabled', (
          select enabled from public.loyalty_programs
          where business_id = '${BUSINESS_ID}'::uuid
        ),
        'earnRate', (
          select earn_points_per_100_minor from public.loyalty_programs
          where business_id = '${BUSINESS_ID}'::uuid
        ),
        'programShopMatch', (
          select cardinality(shop_ids) = 0 or '${SHOP_ID}'::uuid = any(shop_ids)
          from public.loyalty_programs
          where business_id = '${BUSINESS_ID}'::uuid
        ),
        'triggerCount', (
          select count(*)
          from pg_trigger
          where tgrelid = 'public.orders'::regclass
            and tgname = 'orders_post_loyalty_earn'
            and not tgisinternal
        )
      )::text
      from public.loyalty_ledger l
      where l.business_id = '${BUSINESS_ID}'::uuid
        and l.customer_id = '${ORDINARY_EARN_CUSTOMER_ID}'::uuid
        and l.order_id = '${ORDINARY_EARN_ORDER_ID}'::uuid`,
    ],
    'Ordinary loyalty earn readback',
  ).trim(),
);
if (
  Number(ordinaryEarn.points) !== 100 ||
  Number(ordinaryEarn.earnCount) !== 1 ||
  ordinaryEarn.entryKeys?.[0] !== `order-loyalty-earn:${ORDINARY_EARN_ORDER_ID}`
) {
  throw new Error(
    `ordinary finalized customer order did not earn loyalty exactly once: ${JSON.stringify(ordinaryEarn)}`,
  );
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


psql(
  [
    '-c',
    `insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values (
         '${RESERVED_ADJUSTMENT_CUSTOMER_ID}',
         '${BUSINESS_ID}',
         '+201000000004',
         'Reserved Adjustment Customer'
       );
     insert into public.customer_shop_links(business_id, shop_id, canonical_customer_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}', '${RESERVED_ADJUSTMENT_CUSTOMER_ID}');
     insert into public.loyalty_ledger(
       business_id, shop_id, customer_id, entry_key, event_type,
       points_delta, monetary_value_minor, source_event_id, created_at
     ) values (
       '${BUSINESS_ID}', '${SHOP_ID}', '${RESERVED_ADJUSTMENT_CUSTOMER_ID}',
       'reserved-adjustment-credit', 'MANUAL_ADJUSTMENT',
       100, 0, 'reserved-adjustment-credit', '2026-09-23T05:13:00Z'
     );`,
  ],
  'Reserved loyalty adjustment fixture',
);

const adjustmentHoldReservation = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${RESERVED_ADJUSTMENT_CUSTOMER_ID}'::uuid,
    'reserved-adjustment-intent',
    null,
    100,
    'POS',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T05:14:00Z'::timestamptz
  )`,
  'Reserve loyalty before manual debit',
);
if (adjustmentHoldReservation.ok !== true || adjustmentHoldReservation.status !== 'RESERVED') {
  throw new Error(
    `failed to reserve loyalty before manual debit: ${JSON.stringify(adjustmentHoldReservation)}`,
  );
}

const reservedDebit = rpc(
  `public.adjust_admin_customer_loyalty_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${RESERVED_ADJUSTMENT_CUSTOMER_ID}'::uuid,
    -1,
    '${REASON_ID}'::uuid,
    'Must not spend reserved points',
    'loyalty-adjust-held-reserved',
    '${BUSINESS_ID}'::uuid
  )`,
  'Reject manual debit against reserved loyalty',
);
if (reservedDebit.ok !== false || reservedDebit.code !== 'loyalty_balance_insufficient') {
  throw new Error(
    `manual debit spent reserved loyalty points: ${JSON.stringify(reservedDebit)}`,
  );
}

const adjustmentHoldClaim = rpc(
  `public.claim_order_reward_reservation_v1(
    '${adjustmentHoldReservation.reservationId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    'reserved-adjustment-intent',
    '2026-09-23T05:15:00Z'::timestamptz
  )`,
  'Claim loyalty before manual debit',
);
if (adjustmentHoldClaim.ok !== true || adjustmentHoldClaim.status !== 'CLAIMED') {
  throw new Error(
    `failed to claim loyalty before manual debit: ${JSON.stringify(adjustmentHoldClaim)}`,
  );
}

const claimedDebit = rpc(
  `public.adjust_admin_customer_loyalty_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${RESERVED_ADJUSTMENT_CUSTOMER_ID}'::uuid,
    -1,
    '${REASON_ID}'::uuid,
    'Must not spend claimed points',
    'loyalty-adjust-held-claimed',
    '${BUSINESS_ID}'::uuid
  )`,
  'Reject manual debit against claimed loyalty',
);
if (claimedDebit.ok !== false || claimedDebit.code !== 'loyalty_balance_insufficient') {
  throw new Error(
    `manual debit spent claimed loyalty points: ${JSON.stringify(claimedDebit)}`,
  );
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

const reservedReplay = rpc(
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
    '2026-09-23T05:09:30Z'::timestamptz
  )`,
  'Reward reservation same-intent replay',
);
if (
  reservedReplay.ok !== true ||
  reservedReplay.replayed !== true ||
  reservedReplay.reservationId !== reserved.reservationId
) {
  throw new Error(`same checkout intent did not replay reservation: ${JSON.stringify(reservedReplay)}`);
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

const racePromotion = rpc(
  `public.upsert_admin_promotion_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    'Cross channel last slot',
    true,
    'FIXED',
    null,
    500,
    null,
    '2026-09-20T00:00:00Z'::timestamptz,
    '2026-09-30T00:00:00Z'::timestamptz,
    0,
    array['${SHOP_ID}'::uuid],
    'BOTH',
    array[]::uuid[],
    array[]::uuid[],
    1,
    null,
    'ONE_ORDER_LEVEL',
    null,
    'promotion-upsert-race'
  )`,
  'Cross-channel promotion upsert',
);
if (racePromotion.ok !== true || typeof racePromotion.promotionId !== 'string') {
  throw new Error(`cross-channel promotion upsert failed: ${JSON.stringify(racePromotion)}`);
}

const [posSlot, onlineSlot] = await Promise.all([
  rpcAsync(
    `public.reserve_order_rewards_v1(
      '${BUSINESS_ID}'::uuid,
      '${SHOP_ID}'::uuid,
      null,
      'race-promo-pos',
      '${racePromotion.promotionId}'::uuid,
      0,
      'POS',
      10000,
      array['${PRODUCT_ID}'::uuid],
      array['${CATEGORY_ID}'::uuid],
      '2026-09-23T05:20:00Z'::timestamptz
    )`,
    'POS last-slot reservation',
  ),
  rpcAsync(
    `public.reserve_order_rewards_v1(
      '${BUSINESS_ID}'::uuid,
      '${SHOP_ID}'::uuid,
      null,
      'race-promo-online',
      '${racePromotion.promotionId}'::uuid,
      0,
      'ONLINE',
      10000,
      array['${PRODUCT_ID}'::uuid],
      array['${CATEGORY_ID}'::uuid],
      '2026-09-23T05:20:00Z'::timestamptz
    )`,
    'ONLINE last-slot reservation',
  ),
]);
const slotResults = [posSlot, onlineSlot];
if (
  slotResults.filter((result) => result.ok === true).length !== 1 ||
  slotResults.filter((result) => result.code === 'reward_not_available').length !== 1
) {
  throw new Error(`POS-vs-ONLINE last-slot race was not exclusive: ${JSON.stringify(slotResults)}`);
}

const [posLoyalty, onlineLoyalty] = await Promise.all([
  rpcAsync(
    `public.reserve_order_rewards_v1(
      '${BUSINESS_ID}'::uuid,
      '${SHOP_ID}'::uuid,
      '${CUSTOMER_ID}'::uuid,
      'race-loyalty-pos',
      null,
      100,
      'POS',
      10000,
      array['${PRODUCT_ID}'::uuid],
      array['${CATEGORY_ID}'::uuid],
      '2026-09-23T05:21:00Z'::timestamptz
    )`,
    'POS loyalty overspend reservation',
  ),
  rpcAsync(
    `public.reserve_order_rewards_v1(
      '${BUSINESS_ID}'::uuid,
      '${SHOP_ID}'::uuid,
      '${CUSTOMER_ID}'::uuid,
      'race-loyalty-online',
      null,
      100,
      'ONLINE',
      10000,
      array['${PRODUCT_ID}'::uuid],
      array['${CATEGORY_ID}'::uuid],
      '2026-09-23T05:21:00Z'::timestamptz
    )`,
    'ONLINE loyalty overspend reservation',
  ),
]);
const loyaltyRaceResults = [posLoyalty, onlineLoyalty];
if (
  loyaltyRaceResults.filter((result) => result.ok === true).length !== 1 ||
  loyaltyRaceResults.filter((result) => result.code === 'loyalty_balance_changed').length !== 1
) {
  throw new Error(
    `cross-device loyalty overspend race was not exclusive: ${JSON.stringify(loyaltyRaceResults)}`,
  );
}

for (const result of [...slotResults, ...loyaltyRaceResults]) {
  if (result.ok === true && typeof result.reservationId === 'string') {
    const released = rpc(
      `public.release_order_reward_reservation_v1(
        '${result.reservationId}'::uuid,
        '2026-09-23T05:22:00Z'::timestamptz
      )`,
      'Race reservation cleanup',
    );
    if (released.ok !== true) {
      throw new Error(`race reservation cleanup failed: ${JSON.stringify(released)}`);
    }
  }
}

const releaseCapacity = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    'release-capacity-holder',
    '${racePromotion.promotionId}'::uuid,
    0,
    'POS',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T05:23:00Z'::timestamptz
  )`,
  'Reserve last slot for release capacity',
);
if (releaseCapacity.ok !== true) {
  throw new Error(`release-capacity reservation failed: ${JSON.stringify(releaseCapacity)}`);
}
const releasedCapacity = rpc(
  `public.release_order_reward_reservation_v1(
    '${releaseCapacity.reservationId}'::uuid,
    '2026-09-23T05:24:00Z'::timestamptz
  )`,
  'Release last-slot capacity',
);
const releasedCapacityReplay = rpc(
  `public.release_order_reward_reservation_v1(
    '${releaseCapacity.reservationId}'::uuid,
    '2026-09-23T05:24:30Z'::timestamptz
  )`,
  'Replay last-slot capacity release',
);
if (
  releasedCapacity.ok !== true ||
  releasedCapacity.replayed !== false ||
  releasedCapacity.status !== 'RELEASED' ||
  releasedCapacityReplay.ok !== true ||
  releasedCapacityReplay.replayed !== true
) {
  throw new Error(
    `reservation release was not exactly-once: ${JSON.stringify({ releasedCapacity, releasedCapacityReplay })}`,
  );
}

const expiringCapacity = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    'expiry-capacity-holder',
    '${racePromotion.promotionId}'::uuid,
    0,
    'ONLINE',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T05:25:00Z'::timestamptz
  )`,
  'Reserve last slot for expiry capacity',
);
if (expiringCapacity.ok !== true || expiringCapacity.status !== 'RESERVED') {
  throw new Error(`expiry-capacity reservation failed: ${JSON.stringify(expiringCapacity)}`);
}
const expiredReservationCount = Number(
  psql(
    [
      '-At',
      '-c',
      `select public.expire_order_reward_reservations_v1(
        '2026-09-23T05:36:00Z'::timestamptz,
        100
      )`,
    ],
    'Expire reward reservation capacity',
  ).trim(),
);
if (expiredReservationCount !== 1) {
  throw new Error(`reward reservation expiry count was unexpected: ${expiredReservationCount}`);
}
const reacquiredCapacity = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    null,
    'expiry-capacity-holder',
    '${racePromotion.promotionId}'::uuid,
    0,
    'ONLINE',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T05:36:00Z'::timestamptz
  )`,
  'Reacquire expired reward reservation capacity',
);
if (
  reacquiredCapacity.ok !== true ||
  reacquiredCapacity.replayed !== false ||
  reacquiredCapacity.reservationId !== expiringCapacity.reservationId ||
  reacquiredCapacity.status !== 'RESERVED'
) {
  throw new Error(
    `expired reservation was not safely reacquired: ${JSON.stringify(reacquiredCapacity)}`,
  );
}
const releasedReacquiredCapacity = rpc(
  `public.release_order_reward_reservation_v1(
    '${reacquiredCapacity.reservationId}'::uuid,
    '2026-09-23T05:37:00Z'::timestamptz
  )`,
  'Release reacquired reward capacity',
);
if (releasedReacquiredCapacity.ok !== true) {
  throw new Error(
    `reacquired reward reservation cleanup failed: ${JSON.stringify(releasedReacquiredCapacity)}`,
  );
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
  Number(readback.balance) !== 168 ||
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


psql(
  [
    '-c',
    `insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values ('${EXPIRY_CUSTOMER_ID}', '${BUSINESS_ID}', '+201000000008', 'Expiry Customer');
     insert into public.customer_shop_links(business_id, shop_id, canonical_customer_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}', '${EXPIRY_CUSTOMER_ID}');
     insert into public.admin_reason_codes(
       id, business_id, shop_id, reason_key, family, label, active, version, updated_by_employee_id
     ) values
       (
         '${CANCELLATION_REASON_ID}', '${BUSINESS_ID}', null, 'LOYALTY_CANCEL',
         'CANCELLATION', 'Loyalty cancellation', true, 1, '${EMPLOYEE_ID}'
       ),
       (
         '${REFUND_RETURN_REASON_ID}', '${BUSINESS_ID}', null, 'LOYALTY_REFUND_RETURN',
         'REFUND_RETURN', 'Loyalty refund or return', true, 1, '${EMPLOYEE_ID}'
       );
     insert into public.payment_methods(
       id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order
     ) values (
       '${PAYMENT_METHOD_ID}', '${SHOP_ID}', 'Reward cash', 'CASH', false, true, 0
     );
     insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at
     ) values
       (
         '${CANCEL_ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 2, 'loyalty-cancel-order', 'POS', 'ACTIVE',
         '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away', 'TAKE_AWAY',
         null, null, null, null, null, null, 0, 0, 10000, 0, 10000, null,
         '2026-09-23T05:30:00Z', '2026-09-23T05:30:00Z'
       ),
       (
         '${REFUND_ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 3, 'loyalty-refund-order', 'POS', 'DONE',
         '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away', 'TAKE_AWAY',
         null, null, null, null, null, null, 0, 0, 10000, 0, 10000, null,
         '2026-09-23T05:31:00Z', '2026-09-23T05:31:00Z'
       ),
       (
         '${RETURN_ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 4, 'loyalty-return-order', 'POS', 'DONE',
         '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away', 'TAKE_AWAY',
         null, null, null, null, null, null, 0, 0, 10000, 0, 10000, null,
         '2026-09-23T05:32:00Z', '2026-09-23T05:32:00Z'
       );
     insert into public.order_items(
       id, shop_id, order_id, product_id, product_name_snapshot,
       unit_price_minor, quantity, item_note, line_position
     ) values (
       '${RETURN_ITEM_ID}', '${SHOP_ID}', '${RETURN_ORDER_ID}', '${PRODUCT_ID}',
       'Reward Burger', 10000, 1, null, 0
     );
     insert into public.payments(
       id, shop_id, order_id, part_index, payment_method_id,
       payment_method_label_snapshot, logic_type_snapshot, allocated_minor,
       received_minor, change_minor, created_at
     ) values (
       '${REFUND_PAYMENT_ID}', '${SHOP_ID}', '${REFUND_ORDER_ID}', 1, '${PAYMENT_METHOD_ID}',
       'Reward cash', 'CASH', 10000, 10000, 0, '2026-09-23T05:31:00Z'
     );
     insert into public.loyalty_ledger(
       business_id, shop_id, customer_id, order_id, entry_key, event_type,
       points_delta, monetary_value_minor, earn_expires_at, source_event_id
     ) values
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${CANCEL_ORDER_ID}',
         'fixture:cancel:earn', 'EARN', 100, 0, null, 'fixture-cancel'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${CANCEL_ORDER_ID}',
         'fixture:cancel:redeem', 'REDEEM', -20, 200, null, 'fixture-cancel'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${REFUND_ORDER_ID}',
         'fixture:refund:earn', 'EARN', 100, 0, null, 'fixture-refund'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${REFUND_ORDER_ID}',
         'fixture:refund:redeem', 'REDEEM', -20, 200, null, 'fixture-refund'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${RETURN_ORDER_ID}',
         'fixture:return:earn', 'EARN', 100, 0, null, 'fixture-return'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${CUSTOMER_ID}', '${RETURN_ORDER_ID}',
         'fixture:return:redeem', 'REDEEM', -20, 200, null, 'fixture-return'
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${EXPIRY_CUSTOMER_ID}', null,
         'fixture:expiry:earn', 'EARN', 30, 0, '2026-09-22T00:00:00Z', 'fixture-expiry'
       );
     insert into public.promotion_usage_ledger(
       business_id, shop_id, promotion_id, customer_id, order_id,
       entry_key, usage_delta, event_type, applied_rule_snapshot
     ) values
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${promotion.promotionId}', '${CUSTOMER_ID}',
         '${CANCEL_ORDER_ID}', 'fixture:cancel:promotion', 1, 'APPLY', '{}'::jsonb
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${promotion.promotionId}', '${CUSTOMER_ID}',
         '${REFUND_ORDER_ID}', 'fixture:refund:promotion', 1, 'APPLY', '{}'::jsonb
       ),
       (
         '${BUSINESS_ID}', '${SHOP_ID}', '${promotion.promotionId}', '${CUSTOMER_ID}',
         '${RETURN_ORDER_ID}', 'fixture:return:promotion', 1, 'APPLY', '{}'::jsonb
       );`,
  ],
  'Loyalty compensation fixture seed',
);

const cancelledRewardOrder = rpc(
  `public.cancel_admin_order_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CANCEL_ORDER_ID}'::uuid,
    '${CANCELLATION_REASON_ID}'::uuid,
    0,
    'Reward cancellation',
    'loyalty-cancel-comp-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Reward cancellation compensation',
);
if (cancelledRewardOrder.ok !== true) {
  throw new Error(`reward cancellation failed: ${JSON.stringify(cancelledRewardOrder)}`);
}

const refundedRewardOrder = rpc(
  `public.request_admin_order_refund_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${REFUND_ORDER_ID}'::uuid,
    '${REFUND_PAYMENT_ID}'::uuid,
    10000,
    '${REFUND_RETURN_REASON_ID}'::uuid,
    'Full reward refund',
    'loyalty-refund-comp-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Reward refund compensation',
);
if (refundedRewardOrder.ok !== true || refundedRewardOrder.state !== 'POSTED') {
  throw new Error(`reward refund failed: ${JSON.stringify(refundedRewardOrder)}`);
}

const returnedRewardOrder = rpc(
  `public.return_admin_order_items_v1(
    '${EMPLOYEE_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${RETURN_ORDER_ID}'::uuid,
    '[{"orderItemId":"${RETURN_ITEM_ID}","quantity":1}]'::jsonb,
    '${REFUND_RETURN_REASON_ID}'::uuid,
    'Full reward return',
    'loyalty-return-comp-1',
    '${BUSINESS_ID}'::uuid
  )`,
  'Reward return compensation',
);
if (returnedRewardOrder.ok !== true || returnedRewardOrder.state !== 'POSTED') {
  throw new Error(`reward return failed: ${JSON.stringify(returnedRewardOrder)}`);
}

const compensationReadback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
         'cancelBalance', (
           select coalesce(sum(points_delta), 0) from public.loyalty_ledger
           where order_id = '${CANCEL_ORDER_ID}'::uuid
         ),
         'cancelCompCount', (
           select count(*) from public.loyalty_ledger
           where order_id = '${CANCEL_ORDER_ID}'::uuid
             and event_type = 'CANCEL_COMPENSATION'
         ),
         'cancelPromotionUses', (
           select coalesce(sum(usage_delta), 0) from public.promotion_usage_ledger
           where order_id = '${CANCEL_ORDER_ID}'::uuid
         ),
         'refundBalance', (
           select coalesce(sum(points_delta), 0) from public.loyalty_ledger
           where order_id = '${REFUND_ORDER_ID}'::uuid
         ),
         'refundCompCount', (
           select count(*) from public.loyalty_ledger
           where order_id = '${REFUND_ORDER_ID}'::uuid
             and event_type = 'REFUND_COMPENSATION'
         ),
         'refundPromotionUses', (
           select coalesce(sum(usage_delta), 0) from public.promotion_usage_ledger
           where order_id = '${REFUND_ORDER_ID}'::uuid
         ),
         'returnBalance', (
           select coalesce(sum(points_delta), 0) from public.loyalty_ledger
           where order_id = '${RETURN_ORDER_ID}'::uuid
         ),
         'returnCompCount', (
           select count(*) from public.loyalty_ledger
           where order_id = '${RETURN_ORDER_ID}'::uuid
             and event_type = 'RETURN_COMPENSATION'
         ),
         'returnPromotionUses', (
           select coalesce(sum(usage_delta), 0) from public.promotion_usage_ledger
           where order_id = '${RETURN_ORDER_ID}'::uuid
         )
       )::text`,
    ],
    'Reward compensation readback',
  ).trim(),
);

if (
  Number(compensationReadback.cancelBalance) !== 0 ||
  Number(compensationReadback.cancelCompCount) !== 2 ||
  Number(compensationReadback.cancelPromotionUses) !== 0 ||
  Number(compensationReadback.refundBalance) !== 0 ||
  Number(compensationReadback.refundCompCount) !== 2 ||
  Number(compensationReadback.refundPromotionUses) !== 0 ||
  Number(compensationReadback.returnBalance) !== 0 ||
  Number(compensationReadback.returnCompCount) !== 2 ||
  Number(compensationReadback.returnPromotionUses) !== 0
) {
  throw new Error(
    `reward compensation ledger did not reverse finalized effects: ${JSON.stringify(compensationReadback)}`,
  );
}

const expiredRedemption = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${EXPIRY_CUSTOMER_ID}'::uuid,
    'expired-loyalty-reservation',
    null,
    10,
    'POS',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T06:00:00Z'::timestamptz
  )`,
  'Reject expired loyalty before reservation',
);
if (
  expiredRedemption.ok !== false ||
  expiredRedemption.code !== 'loyalty_balance_changed'
) {
  throw new Error(
    `expired loyalty was reservable before expiry materialization: ${JSON.stringify(expiredRedemption)}`,
  );
}

const expiredCount = Number(
  psql(
    [
      '-At',
      '-c',
      `select public.expire_customer_loyalty_points_v1(
        '2026-09-23T06:00:00Z'::timestamptz,
        100
      )`,
    ],
    'Loyalty point expiry',
  ).trim(),
);
const expiryReadback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
        'balance', (
          select coalesce(sum(points_delta), 0) from public.loyalty_ledger
          where business_id = '${BUSINESS_ID}'::uuid
            and customer_id = '${EXPIRY_CUSTOMER_ID}'::uuid
        ),
        'expiryCount', (
          select count(*) from public.loyalty_ledger
          where business_id = '${BUSINESS_ID}'::uuid
            and customer_id = '${EXPIRY_CUSTOMER_ID}'::uuid
            and event_type = 'EXPIRY'
        )
      )::text`,
    ],
    'Loyalty expiry readback',
  ).trim(),
);
if (
  expiredCount !== 0 ||
  Number(expiryReadback.balance) !== 0 ||
  Number(expiryReadback.expiryCount) !== 1
) {
  throw new Error(`expired points were not appended explicitly: ${JSON.stringify(expiryReadback)}`);
}



psql(
  [
    '-c',
    `insert into public.business_customers(id, business_id, normalized_phone, display_name)
       values (
         '${CLAIMED_EXPIRY_CUSTOMER_ID}',
         '${BUSINESS_ID}',
         '+201000000005',
         'Claimed Expiry Customer'
       );
     insert into public.customer_shop_links(business_id, shop_id, canonical_customer_id)
       values ('${BUSINESS_ID}', '${SHOP_ID}', '${CLAIMED_EXPIRY_CUSTOMER_ID}');
     insert into public.loyalty_ledger(
       business_id, shop_id, customer_id, entry_key, event_type,
       points_delta, monetary_value_minor, earn_expires_at, source_event_id, created_at
     ) values (
       '${BUSINESS_ID}', '${SHOP_ID}', '${CLAIMED_EXPIRY_CUSTOMER_ID}',
       'claimed-expiry-credit', 'EARN',
       100, 0, '2026-09-23T07:10:00Z', 'claimed-expiry-credit',
       '2026-09-23T06:59:00Z'
     );`,
  ],
  'Claimed loyalty expiry fixture',
);

const claimedExpiryReservation = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    '${CLAIMED_EXPIRY_CUSTOMER_ID}'::uuid,
    'claimed-expiry-intent',
    null,
    100,
    'POS',
    10000,
    array['${PRODUCT_ID}'::uuid],
    array['${CATEGORY_ID}'::uuid],
    '2026-09-23T07:00:00Z'::timestamptz
  )`,
  'Reserve expiring loyalty',
);
if (claimedExpiryReservation.ok !== true || claimedExpiryReservation.status !== 'RESERVED') {
  throw new Error(
    `failed to reserve expiring loyalty: ${JSON.stringify(claimedExpiryReservation)}`,
  );
}

const claimedExpiryClaim = rpc(
  `public.claim_order_reward_reservation_v1(
    '${claimedExpiryReservation.reservationId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    'claimed-expiry-intent',
    '2026-09-23T07:01:00Z'::timestamptz
  )`,
  'Claim expiring loyalty before local commit',
);
if (claimedExpiryClaim.ok !== true || claimedExpiryClaim.status !== 'CLAIMED') {
  throw new Error(
    `failed to claim expiring loyalty: ${JSON.stringify(claimedExpiryClaim)}`,
  );
}

const claimedProtectedExpiry = Number(
  psql(
    [
      '-At',
      '-c',
      `select private.expire_customer_loyalty_points_for_customer_v1(
        '${BUSINESS_ID}'::uuid,
        '${CLAIMED_EXPIRY_CUSTOMER_ID}'::uuid,
        '2026-09-23T07:20:00Z'::timestamptz
      )`,
    ],
    'Protect claimed loyalty from point expiry',
  ).trim(),
);
const claimedProtectedReadback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
        'balance', coalesce(sum(points_delta), 0),
        'expiryCount', count(*) filter (where event_type = 'EXPIRY')
      )::text
      from public.loyalty_ledger
      where business_id = '${BUSINESS_ID}'::uuid
        and customer_id = '${CLAIMED_EXPIRY_CUSTOMER_ID}'::uuid`,
    ],
    'Claimed loyalty expiry readback',
  ).trim(),
);
if (
  claimedProtectedExpiry !== 0 ||
  Number(claimedProtectedReadback.balance) !== 100 ||
  Number(claimedProtectedReadback.expiryCount) !== 0
) {
  throw new Error(
    `claimed loyalty was expired before delayed sync: ${JSON.stringify({
      claimedProtectedExpiry,
      claimedProtectedReadback,
    })}`,
  );
}

const MERGED_PROMO_CUSTOMER_ID = '79000000-0000-4000-8000-000000000099';
psql(
  [
    '-c',
    `insert into public.business_customers(
       id, business_id, normalized_phone, display_name, merged_into_customer_id
     ) values (
       '${MERGED_PROMO_CUSTOMER_ID}', '${BUSINESS_ID}', '+201000000099',
       'Merged Promotion Customer', '${CUSTOMER_ID}'
     );`,
  ],
  'Merged promotion customer fixture',
);

const mergedIdentityPromotion = rpc(
  `public.upsert_admin_promotion_v1(
    '${EMPLOYEE_ID}'::uuid, '${SHOP_ID}'::uuid, null,
    'Merged identity one-use promotion', true, 'FIXED', null, 500, null,
    null, null, 0, array['${SHOP_ID}'::uuid], 'BOTH',
    array[]::uuid[], array[]::uuid[], null, 1, 'ONE_ORDER_LEVEL',
    null, 'promotion-merged-identity-limit'
  )`,
  'Merged-identity promotion upsert',
);
if (mergedIdentityPromotion.ok !== true) {
  throw new Error(
    `merged-identity promotion upsert failed: ${JSON.stringify(mergedIdentityPromotion)}`,
  );
}
psql(
  [
    '-c',
    `insert into public.promotion_usage_ledger(
       business_id, shop_id, promotion_id, customer_id, order_id,
       entry_key, usage_delta, event_type, applied_rule_snapshot
     ) values (
       '${BUSINESS_ID}', '${SHOP_ID}', '${mergedIdentityPromotion.promotionId}',
       '${MERGED_PROMO_CUSTOMER_ID}', null, 'merged-identity-prior-use',
       1, 'APPLY', '{}'::jsonb
     );`,
  ],
  'Merged-identity promotion usage seed',
);
const mergedIdentityRetry = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid, '${SHOP_ID}'::uuid, '${CUSTOMER_ID}'::uuid,
    'merged-identity-retry', '${mergedIdentityPromotion.promotionId}'::uuid,
    0, 'POS', 10000, array['${PRODUCT_ID}'::uuid], array['${CATEGORY_ID}'::uuid],
    '2026-09-23T06:30:00Z'::timestamptz
  )`,
  'Merged-identity per-customer promotion limit',
);
if (mergedIdentityRetry.ok !== false || mergedIdentityRetry.code !== 'reward_not_available') {
  throw new Error(
    `merged customer bypassed per-customer promotion limit: ${JSON.stringify(mergedIdentityRetry)}`,
  );
}

const committedPromotion = rpc(
  `public.upsert_admin_promotion_v1(
    '${EMPLOYEE_ID}'::uuid, '${SHOP_ID}'::uuid, null,
    'Committed local reward lease', true, 'FIXED', null, 500, null,
    null, null, 0, array['${SHOP_ID}'::uuid], 'BOTH',
    array[]::uuid[], array[]::uuid[], 1, null, 'ONE_ORDER_LEVEL',
    null, 'promotion-committed-lease'
  )`,
  'Committed local reward promotion upsert',
);
if (committedPromotion.ok !== true) {
  throw new Error(`committed reward promotion upsert failed: ${JSON.stringify(committedPromotion)}`);
}
const committedReservation = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid, '${SHOP_ID}'::uuid, null,
    'committed-local-intent', '${committedPromotion.promotionId}'::uuid,
    0, 'POS', 10000, array['${PRODUCT_ID}'::uuid], array['${CATEGORY_ID}'::uuid],
    '2026-09-23T07:00:00Z'::timestamptz
  )`,
  'Committed local reward reservation',
);
if (committedReservation.ok !== true) {
  throw new Error(`committed reward reservation failed: ${JSON.stringify(committedReservation)}`);
}
const claimedReservation = rpc(
  `public.claim_order_reward_reservation_v1(
    '${committedReservation.reservationId}'::uuid,
    '${BUSINESS_ID}'::uuid,
    '${SHOP_ID}'::uuid,
    'committed-local-intent',
    '2026-09-23T07:01:00Z'::timestamptz
  )`,
  'Claim reward reservation before local commit',
);
if (claimedReservation.ok !== true || claimedReservation.status !== 'CLAIMED') {
  throw new Error(
    `reward reservation was not durably claimed before local commit: ${JSON.stringify(claimedReservation)}`,
  );
}
const claimedExpiryCount = Number(
  psql(
    [
      '-At',
      '-c',
      `select public.expire_order_reward_reservations_v1(
        '2026-09-23T07:20:00Z'::timestamptz, 100
      )`,
    ],
    'Expire only abandoned reward reservations',
  ).trim(),
);
if (claimedExpiryCount !== 0) {
  throw new Error(`claimed reward reservation was incorrectly expired: ${claimedExpiryCount}`);
}
const claimedCapacityContender = rpc(
  `public.reserve_order_rewards_v1(
    '${BUSINESS_ID}'::uuid, '${SHOP_ID}'::uuid, null,
    'committed-local-contender', '${committedPromotion.promotionId}'::uuid,
    0, 'ONLINE', 10000, array['${PRODUCT_ID}'::uuid], array['${CATEGORY_ID}'::uuid],
    '2026-09-23T07:20:00Z'::timestamptz
  )`,
  'Claimed reward capacity remains exclusive after original lease',
);
if (
  claimedCapacityContender.ok !== false ||
  claimedCapacityContender.code !== 'reward_not_available'
) {
  throw new Error(
    `claimed reward capacity was reused before delayed sync: ${JSON.stringify(claimedCapacityContender)}`,
  );
}

const CLAIMED_ORDER_ID = '78000000-0000-4000-8000-000000000099';
psql(
  [
    '-c',
    `insert into public.orders(
       id, shop_id, business_day_id, display_order_no, idempotency_key, source, status,
       operator_worker_id, operator_name_snapshot, order_type_id, order_type_label_snapshot,
       order_type_behavior_snapshot, customer_contact_id, customer_name_snapshot,
       normalized_phone_snapshot, address_snapshot, delivery_zone_id,
       delivery_zone_label_snapshot, configured_delivery_fee_minor, final_delivery_fee_minor,
       items_subtotal_minor, discount_minor, total_minor, order_note, created_at, updated_at,
       reward_reservation_id, applied_reward_snapshot
     )
     select
       '${CLAIMED_ORDER_ID}', '${SHOP_ID}', '${DAY_ID}', 99, 'committed-local-intent',
       'POS', 'ACTIVE', '${WORKER_ID}', 'Loyalty Worker', '${ORDER_TYPE_ID}', 'Take Away',
       'TAKE_AWAY', null, null, null, null, null, null, 0, 0,
       10000, 500, 9500, null,
       '2026-09-23T07:02:00Z', '2026-09-23T07:02:00Z',
       r.id, r.applied_reward_snapshot
     from public.reward_reservations r
     where r.id = '${committedReservation.reservationId}'::uuid;`,
  ],
  'Delayed canonical sync of claimed local reward order',
);
const claimedReadback = JSON.parse(
  psql(
    [
      '-At',
      '-c',
      `select jsonb_build_object(
        'status', r.status,
        'consumedOrderId', r.consumed_order_id,
        'promotionUses', (
          select coalesce(sum(u.usage_delta), 0)
          from public.promotion_usage_ledger u
          where u.promotion_id = '${committedPromotion.promotionId}'::uuid
        )
      )::text
      from public.reward_reservations r
      where r.id = '${committedReservation.reservationId}'::uuid`,
    ],
    'Claimed reward delayed-sync readback',
  ).trim(),
);
if (
  claimedReadback.status !== 'CONSUMED' ||
  claimedReadback.consumedOrderId !== CLAIMED_ORDER_ID ||
  Number(claimedReadback.promotionUses) !== 1
) {
  throw new Error(
    `claimed reward did not converge exactly once after lease expiry: ${JSON.stringify(claimedReadback)}`,
  );
}

console.log('Admin loyalty PostgreSQL behavior passed.');

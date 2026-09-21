import { spawnSync } from 'node:child_process';
import fs, { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationName = '20260910130000_admin_inventory_ledger.sql';
const migrationPath = resolve('supabase/migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');
const lower = sql.toLowerCase();

for (const name of [
  'inventory_movements',
  'inventory_unit_conversions',
  'inventory_reservations',
  'inventory_cost_state',
  'stocktakes',
  'stocktake_lines',
  'stock_transfers',
  'stock_transfer_lines',
  'reserve_inventory_for_order_v1',
  'consume_inventory_for_order_v1',
  'restore_order_reservation_v1',
  'release_inventory_for_order_v1',
  'post_inventory_adjustment_v1',
  'post_inventory_waste_v1',
  'begin_stocktake_v1',
  'begin_stocktake_v1',
  'post_stocktake_v1',
  'send_stock_transfer_v1',
  'receive_stock_transfer_v1',
]) {
  if (!lower.includes(name)) throw new Error(`missing ${name}`);
}

if (/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.inventory_movements\b/.test(lower)) {
  throw new Error('existing inventory_movements must be extended, not recreated');
}
if (!lower.includes('alter table public.inventory_movements')) {
  throw new Error('migration must alter the existing inventory ledger additively');
}
for (const legacy of [
  'order_consumption',
  'cancel_restock',
  'bulk_unit_finished',
  'bulk_stock_received',
  'undo_bulk_unit_finished',
  'undo_bulk_stock_received',
  'admin_adjustment',
]) {
  if (!lower.includes(legacy)) throw new Error(`legacy movement type must remain valid: ${legacy}`);
}
for (const requiredType of [
  'order_reservation',
  'order_reservation_release',
  'order_consumption_reversal',
  'waste',
  'stocktake_adjustment',
  'transfer_out',
  'transfer_in',
  'purchase_receipt',
  'purchase_return',
]) {
  if (!lower.includes(requiredType)) throw new Error(`missing inventory movement type: ${requiredType}`);
}
for (const table of [
  'inventory_unit_conversions',
  'inventory_reservations',
  'inventory_cost_state',
  'stocktakes',
  'stocktake_lines',
  'stock_transfers',
  'stock_transfer_lines',
]) {
  if (!lower.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`missing RLS for ${table}`);
  }
}
for (const fn of [
  'reserve_inventory_for_order_v1',
  'consume_inventory_for_order_v1',
  'restore_order_reservation_v1',
  'release_inventory_for_order_v1',
  'post_inventory_adjustment_v1',
  'post_inventory_waste_v1',
  'post_stocktake_v1',
  'send_stock_transfer_v1',
  'receive_stock_transfer_v1',
]) {
  if (!new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`).test(lower)) {
    throw new Error(`${fn} must revoke browser execution`);
  }
  if (!new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*?to\\s+service_role`).test(lower)) {
    throw new Error(`${fn} must grant service_role execution`);
  }
}


const transferLineDefinition = lower.slice(
  lower.indexOf('create table public.stock_transfer_lines'),
  lower.indexOf('alter table public.inventory_movement_feed'),
);
if (!transferLineDefinition.includes('destination_inventory_item_id')) {
  throw new Error('transfer lines must snapshot the destination inventory item at send time');
}
const sendTransfer = lower.slice(
  lower.indexOf('create or replace function public.send_stock_transfer_v1'),
  lower.indexOf('create or replace function public.receive_stock_transfer_v1'),
);
if (!sendTransfer.includes('destination_inventory_item_id')) {
  throw new Error('send_stock_transfer_v1 must persist the resolved destination inventory item');
}
const receiveTransfer = lower.slice(
  lower.indexOf('create or replace function public.receive_stock_transfer_v1'),
  lower.indexOf('revoke all on function public.reserve_inventory_for_order_v1'),
);
if (!receiveTransfer.includes('v_source_line.destination_inventory_item_id')) {
  throw new Error('receive_stock_transfer_v1 must use the immutable destination item snapshot');
}

const sendReplayIndex = sendTransfer.indexOf("'idempotentreplay'");
const sendFirstAuthority = sendTransfer.indexOf('admin_inventory_authority_v1');
const sendSecondAuthority = sendTransfer.indexOf(
  'admin_inventory_authority_v1',
  sendFirstAuthority + 1,
);
if (
  sendReplayIndex < 0 ||
  sendFirstAuthority < 0 ||
  sendSecondAuthority < 0 ||
  sendFirstAuthority > sendReplayIndex ||
  sendSecondAuthority > sendReplayIndex
) {
  throw new Error('transfer send replay must authorize both shops before returning success');
}
if (!sendTransfer.includes('idempotency_conflict')) {
  throw new Error('transfer send replay must reject command reuse for a different destination');
}

const receiveReplayIndex = receiveTransfer.indexOf("'idempotentreplay'");
const receiveAuthorityIndex = receiveTransfer.indexOf('admin_inventory_authority_v1');
if (
  receiveReplayIndex < 0 ||
  receiveAuthorityIndex < 0 ||
  receiveAuthorityIndex > receiveReplayIndex
) {
  throw new Error('transfer receive replay must authorize its destination before returning success');
}

const reservationCapacityStart = lower.indexOf(
  'create or replace function private.enforce_inventory_order_reservation_capacity_v1',
);
const reservationCapacityEnd = lower.indexOf(
  'revoke all on function private.enforce_inventory_order_reservation_capacity_v1',
  reservationCapacityStart,
);
const reservationCapacitySql = lower.slice(reservationCapacityStart, reservationCapacityEnd);
if (
  !reservationCapacitySql.includes("'order_consumption'") ||
  !reservationCapacitySql.includes('new.quantity_delta_micros < 0') ||
  !reservationCapacitySql.includes('coalesce(new.reserved_delta_micros, 0) = 0')
) {
  throw new Error(
    'canonical capacity fence must serialize legacy zero-reservation ORDER_CONSUMPTION',
  );
}

if (
  !lower.includes('enforce_inventory_movement_immutability_v1') ||
  !/before\s+update\s+on\s+public\.inventory_movements/.test(lower)
) {
  throw new Error('canonical inventory movement rows must reject post-insert rewrites');
}
if (
  !lower.includes('assert_operations_placement_inventory_requirements_v1') ||
  !lower.includes('tux_inventory_placement_requirements_mismatch') ||
  !lower.includes('assert_order_inventory_reservations_settled_v1') ||
  !lower.includes('tux_inventory_reservation_not_settled') ||
  !lower.includes('operations_sync_event_receipts')
) {
  throw new Error(
    'canonical sync receipt must validate complete placement requirements and terminal settlement',
  );
}

if (
  !lower.includes('read_admin_inventory_movement_history_v1') ||
  !/row_number\s*\(\s*\)\s*over\s*\(\s*partition\s+by\s+m\.inventory_item_id/i.test(sql) ||
  !/item_rank\s*<=\s*p_per_item_limit/i.test(sql)
) {
  throw new Error('Admin inventory history must be bounded independently per inventory item');
}

const beginStocktake = lower.indexOf('create or replace function public.begin_stocktake_v1');
if (beginStocktake < 0) {
  throw new Error('stocktake must persist a stable DRAFT snapshot before physical counting');
}
const postStocktake = lower.indexOf('create or replace function public.post_stocktake_v1');
const nextAfterPost = lower.indexOf('create or replace function public.send_stock_transfer_v1', postStocktake);
const postStocktakeSql = lower.slice(postStocktake, nextAfterPost < 0 ? undefined : nextAfterPost);
if (!/p_stocktake_id\s+uuid/.test(postStocktakeSql)) {
  throw new Error('stocktake posting must target the previously captured stocktake snapshot');
}
if (postStocktakeSql.includes('insert into public.stocktakes')) {
  throw new Error('post_stocktake_v1 must not create the stocktake snapshot at posting time');
}
if (
  !postStocktakeSql.includes('having count(*) > 1') ||
  !postStocktakeSql.includes('except')
) {
  throw new Error('stocktake posting must validate submitted inventory IDs as an exact set');
}
if (
  !lower.includes('posting_expected_on_hand_micros') ||
  !postStocktakeSql.includes('v_delta := v_actual - v_current_on_hand')
) {
  throw new Error(
    'stocktake posting must reconcile the physical count against canonical on-hand at posting',
  );
}
if (!lower.includes("status, 'draft'") && !lower.includes("'draft'")) {
  throw new Error('stocktake begin flow must retain a DRAFT state before posting');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin inventory ledger static invariant passed.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin inventory ledger behavioral test refuses non-loopback PostgreSQL.');
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

function psqlExpectFailure(args, label, expectedMessage) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly succeeded.`);
  }
  if (!output.includes(expectedMessage)) {
    process.stderr.write(output);
    throw new Error(`${label} failed without ${expectedMessage}.`);
  }
  return output;
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
  'Admin inventory fixture reset',
);

const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(migrationName);
if (targetIndex < 0) throw new Error('Admin inventory migration missing from repository migration chain.');

for (const migration of migrations.slice(0, targetIndex)) {
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const shopId = '14000000-0000-4000-8000-000000000001';
const workerId = '24000000-0000-4000-8000-000000000001';
const dayId = '34000000-0000-4000-8000-000000000001';
const itemId = '44000000-0000-4000-8000-000000000001';
const movementId = '54000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
       values ('${shopId}', 'Inventory Migration Shop', true);
     insert into public.workers(id, shop_id, display_name, pin_hash, active)
       values ('${workerId}', '${shopId}', 'Legacy Worker', 'fixture-pin-hash', true);
     insert into public.business_days(id, shop_id, status, started_at, started_by_worker_id)
       values (
         '${dayId}', '${shopId}', 'OPEN',
         timestamptz '2026-09-19 00:00:00+00', '${workerId}'
       );
     insert into public.inventory_items(id, shop_id, name, unit_label, tracking_mode, active)
       values ('${itemId}', '${shopId}', 'Legacy Flour', 'kg', 'RECIPE_TRACKED', true);
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, worker_id, order_id, compensates_movement_id,
       idempotency_key, created_at
     ) values (
       '${movementId}', '${shopId}', '${dayId}', '${itemId}', 'ADMIN_ADJUSTMENT',
       2500000, '${workerId}', null, null, 'legacy-admin-adjustment', timestamptz '2026-09-19 01:00:00+00'
     );`,
  ],
  'Legacy inventory fixture',
);

const legacyBefore = psql(
  [
    '-At',
    '-c',
    `select to_jsonb(x)::text
     from public.inventory_movements x
     where x.id = '${movementId}'`,
  ],
  'Legacy inventory snapshot before Plan 4 migration',
).trim();

psql(['-f', migrationPath], migrationName);

const legacyAfter = psql(
  [
    '-At',
    '-c',
    `select (
       to_jsonb(x) - array[
         'reserved_delta_micros',
         'admin_employee_id',
         'source_kind',
         'command_id',
         'unit_cost_minor',
         'reason_code_id',
         'reason_code_key',
         'reason_label_snapshot',
         'reason_family_snapshot',
         'reason_config_version',
         'note',
         'emergency_negative_override'
       ]::text[]
     )::text
     from public.inventory_movements x
     where x.id = '${movementId}'`,
  ],
  'Legacy inventory snapshot after Plan 4 migration',
).trim();

if (legacyBefore !== legacyAfter) {
  throw new Error(
    `legacy inventory movement changed across additive migration:\nbefore: ${legacyBefore}\nafter: ${legacyAfter}`,
  );
}

psqlExpectFailure(
  [
    '-c',
    `update public.inventory_movements
     set quantity_delta_micros = quantity_delta_micros + 1
     where id = '${movementId}';`,
  ],
  'Canonical inventory movement rewrite fence',
  'TUX_INVENTORY_MOVEMENT_IMMUTABLE',
);

psql(
  [
    '-c',
    `do $inventory_assertions$
     begin
       if not exists (
         select 1 from public.inventory_movements
         where id = '${movementId}'
           and movement_type = 'ADMIN_ADJUSTMENT'
           and quantity_delta_micros = 2500000
           and reserved_delta_micros = 0
           and worker_id = '${workerId}'
           and source_kind = 'OPERATIONS'
           and idempotency_key = 'legacy-admin-adjustment'
       ) then
         raise exception 'legacy inventory movement identity/history did not survive';
       end if;

       if not exists (
         select 1 from pg_constraint
         where conrelid = 'public.inventory_movements'::regclass
           and pg_get_constraintdef(oid) ilike '%ORDER_CONSUMPTION%'
           and pg_get_constraintdef(oid) ilike '%PURCHASE_RETURN%'
       ) then
         raise exception 'movement type constraint is not a legacy-preserving superset';
       end if;

       if not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'inventory_movements'
           and column_name = 'reserved_delta_micros'
       ) then
         raise exception 'reservation delta column is missing from canonical inventory ledger';
       end if;

       if has_table_privilege('anon', 'public.inventory_reservations', 'SELECT')
          or has_table_privilege('authenticated', 'public.inventory_reservations', 'SELECT') then
         raise exception 'inventory reservation table leaked browser SELECT';
       end if;
     end $inventory_assertions$;`,
  ],
  'Admin inventory additive compatibility assertions',
);

const firstReservationMovementId = '64000000-0000-4000-8000-000000000001';
const secondReservationMovementId = '64000000-0000-4000-8000-000000000002';

psql(
  [
    '-c',
    `insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '${firstReservationMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_RESERVATION', 0, 2000000, '${workerId}',
       'device-a:last-unit-reservation', timestamptz '2026-09-19 02:00:00+00'
     );`,
  ],
  'First canonical device reservation',
);

psqlExpectFailure(
  [
    '-c',
    `insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '${secondReservationMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_RESERVATION', 0, 1000000, '${workerId}',
       'device-b:competing-last-unit-reservation', timestamptz '2026-09-19 02:00:01+00'
     );`,
  ],
  'Competing canonical device reservation',
  'TUX_INVENTORY_INSUFFICIENT_STOCK',
);

const forgedReleaseMovementId = '64000000-0000-4000-8000-000000000003';

psqlExpectFailure(
  [
    '-c',
    `insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '${forgedReleaseMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_RESERVATION_RELEASE', 0, -3000000, '${workerId}',
       'forged:reservation-release', timestamptz '2026-09-19 02:00:01+00'
     );`,
  ],
  'Canonical reservation underflow fence',
  'TUX_INVENTORY_RESERVATION_UNDERFLOW',
);

const unboundReleaseMovementId = '64000000-0000-4000-8000-000000000004';

psqlExpectFailure(
  [
    '-c',
    `insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '${unboundReleaseMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_RESERVATION_RELEASE', 0, -1000000, '${workerId}',
       'forged:unbound-reservation-release', timestamptz '2026-09-19 02:00:01+00'
     );`,
  ],
  'Canonical order-bound reservation release fence',
  'TUX_INVENTORY_RESERVATION_UNDERFLOW',
);

psql(
  [
    '-c',
    `do $reservation_fence_assertion$
     declare
       v_available bigint;
     begin
       select b.available_micros into v_available
       from private.inventory_balance_v1('${shopId}', '${itemId}') b;
       if v_available <> 500000 then
         raise exception 'canonical reservation fence left unexpected available stock: %', v_available;
       end if;
     end $reservation_fence_assertion$;`,
  ],
  'Canonical reservation fence balance assertion',
);

const legacyConsumptionMovementId = '74000000-0000-4000-8000-000000000001';

psqlExpectFailure(
  [
    '-c',
    `insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '${legacyConsumptionMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_CONSUMPTION', -1000000, 0, '${workerId}',
       'legacy-device:competing-placement', timestamptz '2026-09-19 02:00:02+00'
     );`,
  ],
  'Legacy zero-reservation placement capacity fence',
  'TUX_INVENTORY_INSUFFICIENT_STOCK',
);

psql(
  [
    '-c',
    `do $legacy_consumption_fence_assertion$
     declare
       v_available bigint;
     begin
       if exists (
         select 1 from public.inventory_movements
         where id = '${legacyConsumptionMovementId}'
       ) then
         raise exception 'rejected legacy consumption was persisted';
       end if;
       select b.available_micros into v_available
       from private.inventory_balance_v1('${shopId}', '${itemId}') b;
       if v_available <> 500000 then
         raise exception 'legacy consumption fence changed canonical availability: %', v_available;
       end if;
     end $legacy_consumption_fence_assertion$;`,
  ],
  'Legacy placement rejection balance assertion',
);


const configProductId = '85000000-0000-4000-8000-000000000001';
const placementOrderId = '85000000-0000-4000-8000-000000000002';
const terminalOrderId = '85000000-0000-4000-8000-000000000003';
const terminalReservationMovementId = '85000000-0000-4000-8000-000000000004';
const terminalSettlementMovementId = '85000000-0000-4000-8000-000000000005';

psql(
  [
    '-c',
    `insert into public.operations_configuration_snapshots(
       shop_id, version, bundle_json, published_at
     ) values (
       '${shopId}', 9001,
       $bundle$
       {
         "snapshot": {
           "shopId": "${shopId}",
           "version": 9001,
           "modifiers": [],
           "recipeLines": [
             {
               "shopId": "${shopId}",
               "productId": "${configProductId}",
               "inventoryItemId": "${itemId}",
               "quantityMicros": 500000
             }
           ]
         },
         "inventoryItems": []
       }
       $bundle$::jsonb,
       timestamptz '2026-09-19 02:10:00+00'
     );`,
  ],
  'Canonical placement configuration fixture',
);

psqlExpectFailure(
  [
    '-c',
    `select private.assert_operations_placement_inventory_requirements_v1(
       '${shopId}',
       $envelope$
       {
         "payload": {
           "configurationVersion": 9001,
           "order": {
             "id": "${placementOrderId}",
             "items": [
               {
                 "productId": "${configProductId}",
                 "quantity": 2,
                 "modifiers": [],
                 "comboBeverages": []
               }
             ]
           },
           "inventoryMovements": []
         }
       }
       $envelope$::jsonb
     );`,
  ],
  'Incomplete canonical placement reservation set',
  'TUX_INVENTORY_PLACEMENT_REQUIREMENTS_MISMATCH',
);

psql(
  [
    '-c',
    `select private.assert_operations_placement_inventory_requirements_v1(
       '${shopId}',
       $envelope$
       {
         "payload": {
           "configurationVersion": 9001,
           "order": {
             "id": "${placementOrderId}",
             "items": [
               {
                 "productId": "${configProductId}",
                 "quantity": 2,
                 "modifiers": [],
                 "comboBeverages": []
               }
             ]
           },
           "inventoryMovements": [
             {
               "itemId": "${itemId}",
               "movementType": "ORDER_RESERVATION",
               "quantityDeltaMicros": 0,
               "reservedDeltaMicros": 1000000
             }
           ]
         }
       }
       $envelope$::jsonb
     );`,
  ],
  'Complete canonical placement reservation set',
);

psql(
  [
    '-c',
    `set session_replication_role = replica;
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       idempotency_key, created_at
     ) values (
       '${terminalReservationMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_RESERVATION', 0, 100000, '${workerId}', '${terminalOrderId}',
       'terminal-reservation-fixture', timestamptz '2026-09-19 02:11:00+00'
     );
     set session_replication_role = origin;`,
  ],
  'Terminal reservation fixture',
);

psqlExpectFailure(
  [
    '-c',
    `select private.assert_order_inventory_reservations_settled_v1(
       '${shopId}', '${terminalOrderId}'
     );`,
  ],
  'Incomplete terminal reservation settlement',
  'TUX_INVENTORY_RESERVATION_NOT_SETTLED',
);

psql(
  [
    '-c',
    `set session_replication_role = replica;
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
       idempotency_key, created_at
     ) values (
       '${terminalSettlementMovementId}', '${shopId}', '${dayId}', '${itemId}',
       'ORDER_CONSUMPTION', -100000, -100000, '${workerId}', '${terminalOrderId}',
       'terminal-settlement-fixture', timestamptz '2026-09-19 02:12:00+00'
     );
     set session_replication_role = origin;
     select private.assert_order_inventory_reservations_settled_v1(
       '${shopId}', '${terminalOrderId}'
     );`,
  ],
  'Complete terminal reservation settlement',
);

const stocktakeItemId = '86000000-0000-4000-8000-000000000001';
const stocktakeId = '86000000-0000-4000-8000-000000000002';
const stocktakeEmployeeId = '86000000-0000-4000-8000-000000000003';

psql(
  [
    '-c',
    `insert into public.inventory_items(id, shop_id, name, unit_label, tracking_mode, active)
       values ('${stocktakeItemId}', '${shopId}', 'Stocktake Boundary Item', 'unit', 'RECIPE_TRACKED', true);
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '86000000-0000-4000-8000-000000000004', '${shopId}', '${dayId}', '${stocktakeItemId}',
       'BULK_STOCK_RECEIVED', 10000000, 0, '${workerId}',
       'stocktake-boundary-seed', timestamptz '2026-09-19 03:00:00+00'
     );
     set session_replication_role = replica;
     insert into public.stocktakes(
       id, shop_id, created_by_employee_id, status, command_id, started_at, created_at
     ) values (
       '${stocktakeId}', '${shopId}', '${stocktakeEmployeeId}', 'DRAFT',
       'stocktake-boundary-begin', timestamptz '2026-09-19 03:00:01+00',
       timestamptz '2026-09-19 03:00:01+00'
     );
     insert into public.stocktake_lines(
       stocktake_id, inventory_item_id, snapshot_on_hand_micros,
       snapshot_reserved_micros, actual_count_micros, variance_micros,
       unit_cost_minor, created_at
     ) values (
       '${stocktakeId}', '${stocktakeItemId}', 10000000, 0, null, null, 0,
       timestamptz '2026-09-19 03:00:01+00'
     );
     set session_replication_role = origin;
     insert into public.inventory_movements(
       id, shop_id, business_day_id, inventory_item_id, movement_type,
       quantity_delta_micros, reserved_delta_micros, worker_id,
       idempotency_key, created_at
     ) values (
       '86000000-0000-4000-8000-000000000005', '${shopId}', '${dayId}', '${stocktakeItemId}',
       'ADMIN_ADJUSTMENT', -2000000, 0, '${workerId}',
       'stocktake-boundary-intervening-sale', timestamptz '2026-09-19 03:00:02+00'
     );
     create or replace function private.admin_inventory_authority_v1(
       p_employee_id uuid, p_shop_id uuid, p_permission text
     )
     returns table(business_id uuid, employee_role text)
     language sql security definer
     set search_path = pg_catalog, public
     as $auth$ select null::uuid, 'OWNER'::text $auth$;
     set session_replication_role = replica;
     select public.post_stocktake_v1(
       '${stocktakeEmployeeId}', '${shopId}', '${stocktakeId}',
       '[{"inventoryItemId":"${stocktakeItemId}","actualCountMicros":8000000}]'::jsonb,
       'stocktake-boundary-post'
     );
     set session_replication_role = origin;`,
  ],
  'Stocktake posting boundary behavior',
);

psql(
  [
    '-c',
    `do $stocktake_boundary_assertion$
     declare
       v_on_hand bigint;
       v_variance bigint;
       v_posting_expected bigint;
     begin
       select b.on_hand_micros into v_on_hand
       from private.inventory_balance_v1('${shopId}', '${stocktakeItemId}') b;
       if v_on_hand <> 8000000 then
         raise exception 'stocktake double-applied intervening movement: %', v_on_hand;
       end if;
       select l.variance_micros, l.posting_expected_on_hand_micros
         into v_variance, v_posting_expected
       from public.stocktake_lines l
       where l.stocktake_id = '${stocktakeId}'
         and l.inventory_item_id = '${stocktakeItemId}';
       if v_variance <> 0 or v_posting_expected <> 8000000 then
         raise exception 'stocktake posting boundary snapshot is incorrect: %, %',
           v_variance, v_posting_expected;
       end if;
     end $stocktake_boundary_assertion$;`,
  ],
  'Stocktake posting boundary assertion',
);

console.log('Admin inventory ledger static and PostgreSQL compatibility invariants passed.');

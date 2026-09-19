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

psql(
  [
    '-c',
    `do $$
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

       drop table public.plan4_legacy_inventory_snapshot;

       if has_table_privilege('anon', 'public.inventory_reservations', 'SELECT')
          or has_table_privilege('authenticated', 'public.inventory_reservations', 'SELECT') then
         raise exception 'inventory reservation table leaked browser SELECT';
       end if;
     end $$;`,
  ],
  'Admin inventory additive compatibility assertions',
);

console.log('Admin inventory ledger static and PostgreSQL compatibility invariants passed.');

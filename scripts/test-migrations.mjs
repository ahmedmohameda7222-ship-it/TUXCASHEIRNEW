import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for migration smoke testing.');
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Migration smoke refuses to reset a non-loopback PostgreSQL database.');
}

const migrationsDirectory = resolve('supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
if (migrations.length === 0) throw new Error('No repository migrations were found.');

const productDescriptionMigration = '20260827010000_tux_menu_product_descriptions.sql';

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

function seedProductDescriptionFixture() {
  psql(
    [
      '-c',
      `insert into public.shops(id, name, active)
       values ('11000000-0000-4000-8000-000000000001', 'Description Migration Shop', true);

       insert into public.menu_categories(id, shop_id, name, sort_order, active)
       values (
         '31000000-0000-4000-8000-000000000001',
         '11000000-0000-4000-8000-000000000001',
         'Burgers',
         0,
         true
       );

       insert into public.products(
         id, shop_id, category_id, name, description, price_minor, image_key,
         family, active, sold_out, is_combo, sort_order
       ) values
       (
         '41000000-0000-4000-8000-000000000001',
         '11000000-0000-4000-8000-000000000001',
         '31000000-0000-4000-8000-000000000001',
         'Single Smashed Patty',
         null,
         12000,
         null,
         'TUX',
         true,
         false,
         false,
         0
       ),
       (
         '41000000-0000-4000-8000-000000000002',
         '11000000-0000-4000-8000-000000000001',
         '31000000-0000-4000-8000-000000000001',
         'Classic Fries',
         null,
         3000,
         null,
         null,
         true,
         false,
         false,
         1
       );

       insert into public.operations_configuration_snapshots(
         shop_id, version, bundle_json, published_at, published_by_auth_user_id
       ) values (
         '11000000-0000-4000-8000-000000000001',
         7,
         jsonb_build_object(
           'snapshot', jsonb_build_object(
             'shopId', '11000000-0000-4000-8000-000000000001',
             'version', 7,
             'updatedAt', '2026-08-20T00:00:00.000Z',
             'categories', '[]'::jsonb,
             'products', jsonb_build_array(
               jsonb_build_object(
                 'id', '41000000-0000-4000-8000-000000000001',
                 'shopId', '11000000-0000-4000-8000-000000000001',
                 'categoryId', '31000000-0000-4000-8000-000000000001',
                 'name', 'Single Smashed Patty',
                 'description', null,
                 'priceMinor', 12000,
                 'imageKey', null,
                 'family', 'TUX',
                 'active', true,
                 'soldOut', false,
                 'isCombo', false,
                 'sortOrder', 0
               ),
               jsonb_build_object(
                 'id', '41000000-0000-4000-8000-000000000002',
                 'shopId', '11000000-0000-4000-8000-000000000001',
                 'categoryId', '31000000-0000-4000-8000-000000000001',
                 'name', 'Classic Fries',
                 'description', null,
                 'priceMinor', 3000,
                 'imageKey', null,
                 'family', null,
                 'active', true,
                 'soldOut', false,
                 'isCombo', false,
                 'sortOrder', 1
               )
             ),
             'modifiers', '[]'::jsonb,
             'productModifierLinks', '[]'::jsonb,
             'comboBeverageOptions', '[]'::jsonb,
             'recipeLines', '[]'::jsonb,
             'orderTypes', '[]'::jsonb,
             'paymentMethods', '[]'::jsonb,
             'deliveryZones', '[]'::jsonb
           ),
           'inventoryItems', '[]'::jsonb
         ),
         '2026-08-20T00:00:00.000Z',
         null
       );`,
    ],
    'Product description migration fixture',
  );
}

function assertProductDescriptionMigration() {
  psql(
    [
      '-c',
      `do $$
       declare
         v_latest_bundle jsonb;
       begin
         if (
           select description from public.products
           where id = '41000000-0000-4000-8000-000000000001'
         ) is distinct from '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce' then
           raise exception 'approved product description was not persisted';
         end if;

         if (
           select description from public.products
           where id = '41000000-0000-4000-8000-000000000002'
         ) is not null then
           raise exception 'product without an approved description was modified';
         end if;

         if (
           select count(*) from public.operations_configuration_snapshots
           where shop_id = '11000000-0000-4000-8000-000000000001'
         ) <> 2 then
           raise exception 'description migration must publish exactly one new snapshot';
         end if;

         if (
           select max(version) from public.operations_configuration_snapshots
           where shop_id = '11000000-0000-4000-8000-000000000001'
         ) <> 8 then
           raise exception 'description migration did not advance configuration version exactly once';
         end if;

         select bundle_json into v_latest_bundle
         from public.operations_configuration_snapshots
         where shop_id = '11000000-0000-4000-8000-000000000001'
           and version = 8;

         if v_latest_bundle #>> '{snapshot,version}' <> '8' then
           raise exception 'snapshot JSON version was not advanced';
         end if;

         if v_latest_bundle #>> '{snapshot,products,0,description}'
           is distinct from '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce' then
           raise exception 'snapshot JSON product description was not patched';
         end if;

         if v_latest_bundle #>> '{snapshot,products,1,description}' is not null then
           raise exception 'snapshot JSON changed an unapproved product description';
         end if;

         if v_latest_bundle #>> '{snapshot,updatedAt}' = '2026-08-20T00:00:00.000Z' then
           raise exception 'snapshot JSON updatedAt was not advanced';
         end if;

         if (
           select bundle_json #>> '{snapshot,products,0,description}'
           from public.operations_configuration_snapshots
           where shop_id = '11000000-0000-4000-8000-000000000001'
             and version = 7
         ) is not null then
           raise exception 'historical configuration snapshot was mutated';
         end if;
       end $$;`,
    ],
    'Product description migration assertions',
  );
}

function assertWorkerPreferenceRpcCompatibility() {
  psql(
    [
      '-c',
      `insert into auth.users(id) values
         ('91000000-0000-4000-8000-000000000001'),
         ('91000000-0000-4000-8000-000000000002');

       insert into public.shops(id, name, active)
       values ('12000000-0000-4000-8000-000000000001', 'Preference RPC Shop', true);

       insert into public.workers(id, shop_id, display_name, pin_hash, active)
       values (
         '22000000-0000-4000-8000-000000000001',
         '12000000-0000-4000-8000-000000000001',
         'Preference Worker',
         'migration-smoke-pin-hash',
         true
       );

       insert into public.shop_memberships(id, shop_id, auth_user_id, role, active)
       values (
         '92000000-0000-4000-8000-000000000001',
         '12000000-0000-4000-8000-000000000001',
         '91000000-0000-4000-8000-000000000001',
         'OPERATIONS_DEVICE',
         true
       );

       insert into public.devices(id, shop_id, label, active, auth_user_id)
       values (
         '93000000-0000-4000-8000-000000000001',
         '12000000-0000-4000-8000-000000000001',
         'Preference RPC Device',
         true,
         '91000000-0000-4000-8000-000000000001'
       );

       set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000001';
       set role authenticated;

       do $$
       declare
         v_result record;
       begin
         select * into v_result
         from public.put_worker_ui_preferences(
           '12000000-0000-4000-8000-000000000001',
           '22000000-0000-4000-8000-000000000001',
           '["30000000-0000-4000-8000-000000000001"]'::jsonb,
           'left',
           '["40000000-0000-4000-8000-000000000001"]'::jsonb,
           '#1E3A8A'
         );
         if v_result.server_version <> 1 then
           raise exception 'six-argument RPC did not initialize server_version to 1';
         end if;
         if v_result.accent_color is distinct from '#1E3A8A' then
           raise exception 'six-argument RPC did not return the saved accent';
         end if;

         select * into v_result
         from public.put_worker_ui_preferences(
           '12000000-0000-4000-8000-000000000001',
           '22000000-0000-4000-8000-000000000001',
           '["30000000-0000-4000-8000-000000000002"]'::jsonb,
           'right',
           '["40000000-0000-4000-8000-000000000002"]'::jsonb
         );
         if v_result.server_version <> 2 then
           raise exception 'five-argument RPC did not increment server_version exactly once';
         end if;
       end $$;

       reset role;

       do $$
       declare
         v_accent text;
         v_version bigint;
       begin
         select accent_color, server_version
           into v_accent, v_version
         from public.worker_ui_preferences
         where shop_id = '12000000-0000-4000-8000-000000000001'
           and worker_id = '22000000-0000-4000-8000-000000000001';
         if v_accent is distinct from '#1E3A8A' then
           raise exception 'legacy layout update erased the saved accent';
         end if;
         if v_version <> 2 then
           raise exception 'legacy layout update changed server_version more than once';
         end if;
       end $$;

       set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000002';
       set role authenticated;

       do $$
       begin
         begin
           perform *
           from public.put_worker_ui_preferences(
             '12000000-0000-4000-8000-000000000001',
             '22000000-0000-4000-8000-000000000001',
             '[]'::jsonb,
             'left',
             '[]'::jsonb
           );
           raise exception 'unauthorized five-argument RPC unexpectedly succeeded';
         exception
           when others then
             if sqlerrm = 'unauthorized five-argument RPC unexpectedly succeeded' then
               raise;
             end if;
             if position('TUX_WORKER_UI_PREFERENCES_UNAUTHORIZED' in sqlerrm) = 0 then
               raise exception 'unexpected unauthorized RPC error: %', sqlerrm;
             end if;
         end;
       end $$;

       reset role;
       reset request.jwt.claim.sub;`,
    ],
    'Worker UI preference RPC rollout compatibility assertions',
  );
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
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
  'Fresh database reset and Supabase auth compatibility stub',
);

for (const migration of migrations) {
  if (migration === productDescriptionMigration) seedProductDescriptionFixture();
  process.stdout.write(`Applying ${migration}\n`);
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

process.stdout.write(`Replaying ${productDescriptionMigration} to verify idempotency\n`);
psql(
  ['-f', resolve(migrationsDirectory, productDescriptionMigration)],
  `${productDescriptionMigration} idempotency replay`,
);
assertProductDescriptionMigration();
assertWorkerPreferenceRpcCompatibility();

psql(
  [
    '-c',
    `do $$
     begin
       if to_regclass('public.operations_sync_event_receipts') is null then
         raise exception 'operations_sync_event_receipts missing';
       end if;
       if to_regclass('public.operations_configuration_snapshots') is null then
         raise exception 'operations_configuration_snapshots missing';
       end if;
       if to_regclass('private.device_enrollment_codes') is null then
         raise exception 'private.device_enrollment_codes missing';
       end if;
       if not exists (
         select 1 from pg_constraint where conname = 'orders_business_day_same_shop_fk' and contype = 'f'
       ) then
         raise exception 'orders composite tenant FK missing';
       end if;
       if not exists (
         select 1 from pg_constraint where conname = 'orders_return_metadata_ck' and contype = 'c'
       ) then
         raise exception 'orders lifecycle constraint missing';
       end if;
       if not exists (
         select 1 from pg_indexes
         where schemaname = 'public' and indexname = 'worker_sessions_one_open_per_business_day_idx'
       ) then
         raise exception 'worker session unique-open index missing';
       end if;
       if not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'devices' and column_name = 'auth_user_id'
       ) then
         raise exception 'device auth identity column missing';
       end if;
       if to_regprocedure('public.ingest_tux_operations_materialization_v1(uuid,uuid,jsonb,text,jsonb)') is null then
         raise exception 'Operations sync receiver RPC missing';
       end if;
       if to_regprocedure('public.create_tux_device_enrollment(uuid,text,integer)') is null then
         raise exception 'device enrollment RPC missing';
       end if;
       if to_regprocedure('public.publish_tux_operations_configuration(uuid,integer,jsonb,uuid)') is null then
         raise exception 'configuration publish RPC missing';
       end if;
       if to_regprocedure('public.put_worker_ui_preferences(uuid,uuid,jsonb,text,jsonb)') is null then
         raise exception 'legacy worker UI preference RPC missing';
       end if;
       if to_regprocedure('public.put_worker_ui_preferences(uuid,uuid,jsonb,text,jsonb,text)') is null then
         raise exception 'accent worker UI preference RPC missing';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'orders' and c.relrowsecurity
       ) then
         raise exception 'orders RLS is not enabled';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'operations_sync_event_receipts' and c.relrowsecurity
       ) then
         raise exception 'sync receipts RLS is not enabled';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'operations_configuration_snapshots' and c.relrowsecurity
       ) then
         raise exception 'configuration snapshots RLS is not enabled';
       end if;
       if not exists (
         select 1 from pg_policies
         where schemaname = 'public'
           and tablename = 'operations_configuration_snapshots'
           and policyname = 'operations_configuration_device_select'
       ) then
         raise exception 'configuration device RLS policy missing';
       end if;
       if exists (
         select 1 from pg_constraint
         where conname in (
           'order_item_combo_beverages_order_item_id_unit_index_key',
           'reconciliation_lines_reconciliation_id_payment_method_id_key'
         )
       ) then
         raise exception 'redundant unique constraints reintroduced';
       end if;
     end $$;`,
  ],
  'Post-migration invariant assertions',
);

process.stdout.write(`Migration smoke passed: ${migrations.join(' -> ')}\n`);
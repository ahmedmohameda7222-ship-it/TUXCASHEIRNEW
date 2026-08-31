import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for migration smoke testing.');
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Worker Menu Layout migration smoke refuses a non-loopback database.');
}

const migrationsDirectory = resolve('supabase/migrations');
const targetMigration = '20260831183000_worker_menu_layouts.sql';
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
if (!migrations.includes(targetMigration)) throw new Error(`${targetMigration} is missing.`);

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
     drop schema if exists auth cascade;
     create schema auth;
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
  'Worker Menu Layout isolated database reset',
);

function seedLegacyLayoutFixture() {
  psql(
    [
      '-c',
      `insert into auth.users(id) values
         ('91000000-0000-4000-8000-000000000011'),
         ('91000000-0000-4000-8000-000000000012');

       insert into public.shops(id, name, active) values
         ('11000000-0000-4000-8000-000000000011', 'Menu Layout Shop A', true),
         ('11000000-0000-4000-8000-000000000012', 'Menu Layout Shop B', true);

       insert into public.workers(id, shop_id, display_name, pin_hash, active) values
         ('21000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'Worker A', 'hash-a', true),
         ('21000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000011', 'Worker A2', 'hash-a2', true),
         ('21000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000012', 'Worker B', 'hash-b', true);

       insert into public.shop_memberships(id, shop_id, auth_user_id, role, active) values
         ('92000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000011', 'OPERATIONS_DEVICE', true);

       insert into public.devices(id, shop_id, label, active, auth_user_id) values
         ('93000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'Menu Layout Device', true, '91000000-0000-4000-8000-000000000011');

       insert into public.menu_categories(id, shop_id, name, sort_order, active) values
         ('31000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', 'A', 0, true),
         ('31000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000011', 'B', 1, true),
         ('31000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000012', 'Foreign', 0, true);

       insert into public.products(
         id, shop_id, category_id, name, description, price_minor, image_key,
         active, sold_out, is_combo, sort_order
       ) values
         ('41000000-0000-4000-8000-000000000011', '11000000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000011', 'A1', null, 100, null, true, false, false, 0),
         ('41000000-0000-4000-8000-000000000012', '11000000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000011', 'A2', null, 100, null, true, false, false, 1),
         ('41000000-0000-4000-8000-000000000013', '11000000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000012', 'B1', null, 100, null, true, false, false, 0),
         ('41000000-0000-4000-8000-000000000014', '11000000-0000-4000-8000-000000000012', '31000000-0000-4000-8000-000000000013', 'Foreign Product', null, 100, null, true, false, false, 0);

       insert into public.worker_ui_preferences(
         shop_id, worker_id, category_order, category_alignment, product_order,
         accent_color, server_version, updated_at
       ) values (
         '11000000-0000-4000-8000-000000000011',
         '21000000-0000-4000-8000-000000000011',
         '["31000000-0000-4000-8000-000000000012","ffffffff-ffff-4fff-8fff-ffffffffffff","31000000-0000-4000-8000-000000000011"]'::jsonb,
         'right',
         '["41000000-0000-4000-8000-000000000012","41000000-0000-4000-8000-000000000013","ffffffff-ffff-4fff-8fff-ffffffffffff","41000000-0000-4000-8000-000000000011"]'::jsonb,
         '#1E3A8A',
         4,
         '2026-08-31T10:00:00Z'
       );`,
    ],
    'Worker Menu Layout legacy fixture',
  );
}

for (const migration of migrations) {
  if (migration === targetMigration) seedLegacyLayoutFixture();
  process.stdout.write(`Applying ${migration}\n`);
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

psql(
  [
    '-c',
    `do $$
     declare
       v_layout record;
       v_generated_categories jsonb;
       v_generated_products jsonb;
     begin
       select * into v_layout
       from public.worker_menu_layouts
       where shop_id = '11000000-0000-4000-8000-000000000011'
         and worker_id = '21000000-0000-4000-8000-000000000011';

       if v_layout.category_order is distinct from '["31000000-0000-4000-8000-000000000012","31000000-0000-4000-8000-000000000011"]'::jsonb then
         raise exception 'legacy category order backfill was not preserved';
       end if;
       if v_layout.product_order_by_category is distinct from '{"31000000-0000-4000-8000-000000000011":["41000000-0000-4000-8000-000000000012","41000000-0000-4000-8000-000000000011"],"31000000-0000-4000-8000-000000000012":["41000000-0000-4000-8000-000000000013"]}'::jsonb then
         raise exception 'legacy flat product order was not grouped by actual category';
       end if;
       if v_layout.layout_version <> 4 then
         raise exception 'legacy layout version was not preserved';
       end if;
       if (select accent_color from public.worker_ui_preferences where shop_id = v_layout.shop_id and worker_id = v_layout.worker_id) is distinct from '#1E3A8A' then
         raise exception 'Menu Layout migration modified System Color';
       end if;
       if not exists (
         select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'worker_menu_layouts' and c.relrowsecurity
       ) then
         raise exception 'worker_menu_layouts RLS is not enabled';
       end if;
       if to_regprocedure('public.put_worker_menu_layout_v2(uuid,uuid,jsonb,text,jsonb,bigint)') is null then
         raise exception 'put_worker_menu_layout_v2 RPC is missing';
       end if;

       set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000011';
       set local role authenticated;

       select * into v_layout
       from public.put_worker_menu_layout_v2(
         '11000000-0000-4000-8000-000000000011',
         '21000000-0000-4000-8000-000000000011',
         '["31000000-0000-4000-8000-000000000011","31000000-0000-4000-8000-000000000012"]'::jsonb,
         'center',
         '{"31000000-0000-4000-8000-000000000011":["41000000-0000-4000-8000-000000000011","41000000-0000-4000-8000-000000000012"],"31000000-0000-4000-8000-000000000012":["41000000-0000-4000-8000-000000000013"]}'::jsonb,
         4
       );
       if v_layout.layout_version <> 5 then
         raise exception 'CAS update did not increment layout_version';
       end if;

       select * into v_layout
       from public.put_worker_menu_layout_v2(
         '11000000-0000-4000-8000-000000000011',
         '21000000-0000-4000-8000-000000000012',
         '[]'::jsonb,
         'left',
         '{}'::jsonb,
         null
       );
       if v_layout.layout_version <> 1 then
         raise exception 'first insert did not initialize layout_version to 1';
       end if;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left', '{}'::jsonb, 4
         );
         raise exception 'stale CAS unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'stale CAS unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '["31000000-0000-4000-8000-000000000011","31000000-0000-4000-8000-000000000011"]'::jsonb,
           'left', '{}'::jsonb, 5
         );
         raise exception 'duplicate category unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'duplicate category unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_CATEGORY_DUPLICATE' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '["31000000-0000-4000-8000-000000000013"]'::jsonb, 'left', '{}'::jsonb, 5
         );
         raise exception 'foreign category unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'foreign category unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_CATEGORY_REFERENCE_INVALID' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left',
           '{"31000000-0000-4000-8000-000000000012":["41000000-0000-4000-8000-000000000011"]}'::jsonb,
           5
         );
         raise exception 'wrong-category product unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'wrong-category product unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_PRODUCT_REFERENCE_INVALID' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left',
           '{"31000000-0000-4000-8000-000000000011":["41000000-0000-4000-8000-000000000011"],"31000000-0000-4000-8000-000000000012":["41000000-0000-4000-8000-000000000011"]}'::jsonb,
           5
         );
         raise exception 'duplicate product unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'duplicate product unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_PRODUCT_DUPLICATE' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left',
           '{"31000000-0000-4000-8000-000000000011":"not-an-array"}'::jsonb,
           5
         );
         raise exception 'malformed product mapping unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'malformed product mapping unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_VALUE_INVALID' in sqlerrm) = 0 then raise; end if;
       end;

       select jsonb_agg(gen_random_uuid()::text) into v_generated_categories from generate_series(1, 257);
       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           v_generated_categories, 'left', '{}'::jsonb, 5
         );
         raise exception 'oversized category list unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'oversized category list unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_CATEGORY_COUNT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
       end;

       select jsonb_agg('41000000-0000-4000-8000-000000000011'::text) into v_generated_products from generate_series(1, 4097);
       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left',
           jsonb_build_object('31000000-0000-4000-8000-000000000011', v_generated_products), 5
         );
         raise exception 'oversized product list unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'oversized product list unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_TOO_LARGE' in sqlerrm) = 0 then raise; end if;
       end;

       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000013',
           '[]'::jsonb, 'left', '{}'::jsonb, null
         );
         raise exception 'foreign worker unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'foreign worker unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_WORKER_INVALID' in sqlerrm) = 0 then raise; end if;
       end;

       reset role;
       set local request.jwt.claim.sub = '91000000-0000-4000-8000-000000000012';
       set local role authenticated;
       begin
         perform * from public.put_worker_menu_layout_v2(
           '11000000-0000-4000-8000-000000000011', '21000000-0000-4000-8000-000000000011',
           '[]'::jsonb, 'left', '{}'::jsonb, 5
         );
         raise exception 'unauthorized layout write unexpectedly succeeded';
       exception when others then
         if sqlerrm = 'unauthorized layout write unexpectedly succeeded' or position('TUX_WORKER_MENU_LAYOUT_UNAUTHORIZED' in sqlerrm) = 0 then raise; end if;
       end;
     end $$;`,
  ],
  'Worker Menu Layout backfill, validation, and CAS assertions',
);

process.stdout.write('Worker Menu Layout migration smoke passed.\n');

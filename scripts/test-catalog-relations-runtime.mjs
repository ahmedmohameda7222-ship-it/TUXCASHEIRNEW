import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for catalog relationship runtime testing.');
}
const databaseHost = new URL(databaseUrl).hostname;
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(databaseHost)) {
  throw new Error('Catalog relationship runtime test refuses a non-loopback PostgreSQL database.');
}

const migrationsDirectory = resolve('supabase/migrations');
const relationshipMigration = '20260910003000_catalog_product_relationships.sql';
const migrations = readdirSync(migrationsDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const manifest = JSON.parse(
  readFileSync('scripts/catalog-migration/catalog-relations-manifest.json', 'utf8'),
);

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

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists private cascade;
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
  'Catalog relationship runtime database reset',
);

for (const migration of migrations) {
  if (migration === relationshipMigration) break;
  process.stdout.write(`Applying prerequisite ${migration}\n`);
  psql(['-f', resolve(migrationsDirectory, migration)], migration);
}

const shopId = manifest.shopId;
const extrasCategoryId = manifest.extraCategoryId;
const drinksCategoryId = '26ecbec9-0883-5acf-a413-4ccdce760bd8';
const mainCategoryId = 'dac1ac74-aa52-5804-966c-cef65d196fd4';
const beverageIds = new Set(manifest.beverageProductIds);
const comboIds = new Set(manifest.comboProductIds);
const familyProductId = manifest.eligibleProductIds.find((id) => !beverageIds.has(id));

const extraRows = manifest.modifiers.map((modifier) =>
  `(${sqlText(modifier.standaloneProductId)}::uuid, ${sqlText(shopId)}::uuid, ${sqlText(extrasCategoryId)}::uuid, ${sqlText(modifier.name)}, null, ${modifier.priceMinor}, null, ${modifier.active}, false, false, ${modifier.sortOrder}, null, null, false)`,
);
const eligibleRows = manifest.eligibleProductIds.map((id, index) => {
  const categoryId = beverageIds.has(id) ? drinksCategoryId : mainCategoryId;
  const family = id === familyProductId ? sqlText('Runtime Family') : 'null';
  return `(${sqlText(id)}::uuid, ${sqlText(shopId)}::uuid, ${sqlText(categoryId)}::uuid, ${sqlText(`Runtime Product ${index + 1}`)}, null, ${1000 + index}, null, true, false, ${comboIds.has(id)}, ${index}, ${family}, null, false)`;
});

psql(
  [
    '-c',
    `insert into public.shops(id, name, active)
     values (${sqlText(shopId)}::uuid, 'Catalog Relationship Runtime Shop', true);

     insert into public.menu_categories(
       id, shop_id, name, sort_order, active, slug, description
     ) values
       (${sqlText(mainCategoryId)}::uuid, ${sqlText(shopId)}::uuid, 'Burgers', 0, true, 'burgers', null),
       (${sqlText(extrasCategoryId)}::uuid, ${sqlText(shopId)}::uuid, 'Extras', 1, true, 'extras', null),
       (${sqlText(drinksCategoryId)}::uuid, ${sqlText(shopId)}::uuid, 'Drinks', 2, true, 'drinks', null);

     insert into public.products(
       id, shop_id, category_id, name, description, price_minor, image_key,
       active, sold_out, is_combo, sort_order, family, slug, best_seller
     ) values
       ${[...extraRows, ...eligibleRows].join(',\n       ')};

     insert into public.inventory_items(
       id, shop_id, name, unit_label, tracking_mode, active
     ) values (
       '51000000-0000-4000-8000-000000000001', ${sqlText(shopId)}::uuid,
       'Runtime Inventory', 'unit', 'RECIPE_TRACKED', true
     );

     insert into public.recipe_lines(shop_id, product_id, inventory_item_id, quantity_micros)
     values (
       ${sqlText(shopId)}::uuid, ${sqlText(familyProductId)}::uuid,
       '51000000-0000-4000-8000-000000000001', 1000000
     );

     insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
     values (
       '52000000-0000-4000-8000-000000000001', ${sqlText(shopId)}::uuid,
       'Delivery', 'DELIVERY', true, 0
     );

     insert into public.payment_methods(
       id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order
     ) values (
       '53000000-0000-4000-8000-000000000001', ${sqlText(shopId)}::uuid,
       'Cash', 'CASH', true, true, 0
     );

     insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order)
     values (
       '54000000-0000-4000-8000-000000000001', ${sqlText(shopId)}::uuid,
       'Runtime Zone', 2500, true, 0
     );

     insert into public.operations_configuration_snapshots(
       shop_id, version, bundle_json, published_at, published_by_auth_user_id
     )
     select
       ${sqlText(shopId)}::uuid,
       41,
       jsonb_build_object(
         'snapshot', jsonb_build_object(
           'shopId', ${sqlText(shopId)},
           'version', 41,
           'updatedAt', '2026-09-09T20:00:00.000Z',
           'categories', coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'shopId', c.shop_id,
               'name', c.name,
               'sortOrder', c.sort_order,
               'active', c.active
             ) order by c.sort_order, c.id)
             from public.menu_categories c
             where c.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb),
           'products', coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'shopId', p.shop_id,
               'categoryId', p.category_id,
               'name', p.name,
               'description', p.description,
               'priceMinor', p.price_minor,
               'imageKey', p.image_key,
               'family', p.family,
               'active', p.active,
               'soldOut', p.sold_out,
               'isCombo', p.is_combo,
               'sortOrder', p.sort_order
             ) order by p.category_id, p.sort_order, p.id)
             from public.products p
             where p.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb),
           'modifiers', '[]'::jsonb,
           'productModifierLinks', '[]'::jsonb,
           'comboBeverageOptions', '[]'::jsonb,
           'recipeLines', coalesce((
             select jsonb_agg(jsonb_build_object(
               'shopId', r.shop_id,
               'productId', r.product_id,
               'inventoryItemId', r.inventory_item_id,
               'quantityMicros', r.quantity_micros
             ) order by r.product_id, r.inventory_item_id)
             from public.recipe_lines r
             where r.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb),
           'orderTypes', coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', o.id,
               'shopId', o.shop_id,
               'name', o.name,
               'behavior', o.behavior,
               'active', o.active,
               'sortOrder', o.sort_order
             ) order by o.sort_order, o.id)
             from public.order_types o
             where o.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb),
           'paymentMethods', coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'shopId', p.shop_id,
               'displayName', p.display_name,
               'logicType', p.logic_type,
               'requiresReconciliation', p.requires_reconciliation,
               'active', p.active,
               'sortOrder', p.sort_order
             ) order by p.sort_order, p.id)
             from public.payment_methods p
             where p.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb),
           'deliveryZones', coalesce((
             select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'shopId', d.shop_id,
               'name', d.name,
               'feeMinor', d.fee_minor,
               'active', d.active,
               'sortOrder', d.sort_order
             ) order by d.sort_order, d.id)
             from public.delivery_zones d
             where d.shop_id = ${sqlText(shopId)}::uuid
           ), '[]'::jsonb)
         ),
         'inventoryItems', coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', i.id,
             'shopId', i.shop_id,
             'name', i.name,
             'unitLabel', i.unit_label,
             'trackingMode', i.tracking_mode,
             'active', i.active
           ) order by i.id)
           from public.inventory_items i
           where i.shop_id = ${sqlText(shopId)}::uuid
         ), '[]'::jsonb)
       ),
       '2026-09-09T20:00:00.000Z',
       null;`,
  ],
  'Catalog relationship canonical runtime fixture',
);

process.stdout.write(`Applying target ${relationshipMigration}\n`);
psql(['-f', resolve(migrationsDirectory, relationshipMigration)], relationshipMigration);

psql(
  [
    '-c',
    `do $$
     declare
       v_latest_bundle jsonb;
       v_historical_bundle jsonb;
     begin
       if (
         select count(*)
         from public.operations_configuration_snapshots
         where shop_id = ${sqlText(shopId)}::uuid
       ) <> 2 then
         raise exception 'relationship migration must publish exactly one Operations snapshot';
       end if;

       if (
         select max(version)
         from public.operations_configuration_snapshots
         where shop_id = ${sqlText(shopId)}::uuid
       ) <> 42 then
         raise exception 'relationship migration must advance Operations configuration version exactly once';
       end if;

       select bundle_json into v_latest_bundle
       from public.operations_configuration_snapshots
       where shop_id = ${sqlText(shopId)}::uuid
         and version = 42;

       if v_latest_bundle #>> '{snapshot,shopId}' is distinct from ${sqlText(shopId)} then
         raise exception 'published relationship snapshot has the wrong shop identity';
       end if;
       if v_latest_bundle #>> '{snapshot,version}' is distinct from '42' then
         raise exception 'published relationship snapshot JSON version was not advanced';
       end if;
       if jsonb_array_length(v_latest_bundle #> '{snapshot,modifiers}') <> 13 then
         raise exception 'Operations snapshot must contain 13 canonical modifiers';
       end if;
       if jsonb_array_length(v_latest_bundle #> '{snapshot,productModifierLinks}') <> 468 then
         raise exception 'Operations snapshot must contain 468 product-modifier links';
       end if;
       if jsonb_array_length(v_latest_bundle #> '{snapshot,comboBeverageOptions}') <> 10 then
         raise exception 'Operations snapshot must contain 10 combo beverage options';
       end if;

       if jsonb_array_length(v_latest_bundle #> '{snapshot,categories}') <> 3
          or jsonb_array_length(v_latest_bundle #> '{snapshot,products}') <> 49
          or jsonb_array_length(v_latest_bundle #> '{snapshot,recipeLines}') <> 1
          or jsonb_array_length(v_latest_bundle #> '{snapshot,orderTypes}') <> 1
          or jsonb_array_length(v_latest_bundle #> '{snapshot,paymentMethods}') <> 1
          or jsonb_array_length(v_latest_bundle #> '{snapshot,deliveryZones}') <> 1
          or jsonb_array_length(v_latest_bundle -> 'inventoryItems') <> 1 then
         raise exception 'relationship snapshot did not preserve the complete Operations configuration';
       end if;

       if (
         select product ->> 'family'
         from jsonb_array_elements(v_latest_bundle #> '{snapshot,products}') product
         where product ->> 'id' = ${sqlText(familyProductId)}
       ) is distinct from 'Runtime Family' then
         raise exception 'relationship snapshot did not preserve product family metadata';
       end if;
       if (
         select family from public.products where id = ${sqlText(familyProductId)}::uuid
       ) is distinct from 'Runtime Family' then
         raise exception 'snapshot publication changed live product family metadata';
       end if;

       if v_latest_bundle #>> '{snapshot,updatedAt}' = '2026-09-09T20:00:00.000Z' then
         raise exception 'relationship snapshot updatedAt was not advanced';
       end if;

       select bundle_json into v_historical_bundle
       from public.operations_configuration_snapshots
       where shop_id = ${sqlText(shopId)}::uuid
         and version = 41;
       if jsonb_array_length(v_historical_bundle #> '{snapshot,modifiers}') <> 0
          or jsonb_array_length(v_historical_bundle #> '{snapshot,productModifierLinks}') <> 0
          or jsonb_array_length(v_historical_bundle #> '{snapshot,comboBeverageOptions}') <> 0 then
         raise exception 'historical Operations configuration snapshot was mutated';
       end if;
     end $$;`,
  ],
  'Catalog relationship Operations snapshot assertions',
);

console.log('catalog relationship Operations snapshot runtime: ok');

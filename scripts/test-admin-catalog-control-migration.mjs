import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910110000_admin_catalog_control.sql';
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

const requiredObjects = [
  'catalog_master_products',
  'catalog_master_categories',
  'catalog_product_shop_overrides',
  'catalog_drafts',
  'catalog_draft_changes',
  'catalog_publish_versions',
  'scheduled_config_changes',
  'recurring_availability_rules',
  'create_catalog_draft_v1',
  'apply_catalog_draft_change_v1',
  'publish_catalog_draft_v1',
  'set_immediate_product_availability_v1',
];

for (const name of requiredObjects) {
  if (!sql.includes(name)) {
    throw new Error(`admin catalog control migration missing ${name}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog control migration static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog control behavioral test refuses non-loopback PostgreSQL.');
}

const shopId = '16000000-0000-4000-8000-000000000001';
const employeeId = '26000000-0000-4000-8000-000000000001';
const categoryId = '36000000-0000-4000-8000-000000000001';
const productId = '46000000-0000-4000-8000-000000000001';
const businessId = '00000000-0000-4000-8000-000000000001';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Admin Catalog Control Fixture', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Catalog Fixture Owner', 'OWNER', true);

insert into public.menu_categories(
  id, shop_id, slug, name, description, sort_order, active
) values (
  '${categoryId}', '${shopId}', 'fixture-burgers', 'Fixture Burgers',
  'Fixture category', 0, true
);

insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'fixture-burger', 'Fixture Burger',
  'Fixture product', 1000, null, 'FIXTURE', false, true, false, false, 0
);

do $$
declare
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_immediate jsonb;
  v_replay jsonb;
  v_stale jsonb;
  v_draft_id uuid;
  v_stale_draft_id uuid;
  v_bundle jsonb;
  v_snapshot_one jsonb;
  v_snapshot_one_after jsonb;
  v_count integer;
begin
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 0, 'Fixture price draft'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog draft creation failed: %', v_create;
  end if;
  if (v_create ->> 'basePublishVersion')::bigint <> 0
     or (v_create ->> 'draftRevision')::bigint <> 1 then
    raise exception 'catalog draft initial version mismatch: %', v_create;
  end if;

  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';
  if v_bundle #>> '{snapshot,products,0,priceMinor}' <> '1000'
     or v_bundle #>> '{snapshot,products,0,soldOut}' <> 'false' then
    raise exception 'catalog draft did not clone canonical live state';
  end if;

  v_bundle := jsonb_set(v_bundle, '{snapshot,products,0,priceMinor}', '1500'::jsonb, false);
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true
     or (v_apply ->> 'draftRevision')::bigint <> 2 then
    raise exception 'catalog draft change failed: %', v_apply;
  end if;

  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 0
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 1
     or (v_publish ->> 'operationsConfigurationVersion')::integer <> 1 then
    raise exception 'catalog atomic publish failed: %', v_publish;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}'
      and p.shop_id = '${shopId}'
      and p.price_minor = 1500
      and p.sold_out = false
      and p.slug = 'fixture-burger'
      and p.family = 'FIXTURE'
  ) then
    raise exception 'catalog publish did not materialize canonical product state';
  end if;

  if not exists (
    select 1 from public.catalog_drafts d
    where d.id = v_draft_id
      and d.status = 'PUBLISHED'
      and d.published_version = 1
  ) then
    raise exception 'catalog draft was not terminally marked published';
  end if;

  if not exists (
    select 1
    from public.catalog_product_shop_overrides o
    join public.catalog_master_products p on p.id = o.master_product_id
    where o.shop_id = '${shopId}'
      and o.canonical_product_id = '${productId}'
      and o.price_minor = 1500
      and o.manual_sold_out = false
      and p.canonical_name = 'Fixture Burger'
  ) then
    raise exception 'catalog master/override mapping did not converge after publish';
  end if;

  select s.bundle_json into v_snapshot_one
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' and s.version = 1;
  if v_snapshot_one #>> '{snapshot,products,0,priceMinor}' <> '1500'
     or v_snapshot_one #>> '{snapshot,products,0,soldOut}' <> 'false' then
    raise exception 'first Operations snapshot does not match published state';
  end if;

  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 1, 'Must become stale'
  );
  v_stale_draft_id := (v_create ->> 'draftId')::uuid;
  if coalesce((v_create ->> 'ok')::boolean, false) is not true
     or (v_create ->> 'basePublishVersion')::bigint <> 1 then
    raise exception 'second catalog draft creation failed: %', v_create;
  end if;

  v_immediate := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 2
     or (v_immediate ->> 'operationsConfigurationVersion')::integer <> 2 then
    raise exception 'immediate availability publish failed: %', v_immediate;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = true
  ) then
    raise exception 'immediate availability did not reach canonical product';
  end if;

  select s.bundle_json into v_snapshot_one_after
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' and s.version = 1;
  if v_snapshot_one_after is distinct from v_snapshot_one then
    raise exception 'historical Operations snapshot was mutated';
  end if;

  if (
    select s.bundle_json #>> '{snapshot,products,0,soldOut}'
    from public.operations_configuration_snapshots s
    where s.shop_id = '${shopId}' and s.version = 2
  ) <> 'true' then
    raise exception 'immediate availability snapshot missing sold-out state';
  end if;

  v_stale := public.publish_catalog_draft_v1(
    '${employeeId}', v_stale_draft_id, 1, 1
  );
  if v_stale ->> 'code' <> 'stale_version'
     or (v_stale ->> 'currentVersion')::bigint <> 2 then
    raise exception 'stale draft was not fenced after immediate live mutation: %', v_stale;
  end if;

  select count(*) into v_count
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}';
  if v_count <> 2 then
    raise exception 'stale publish unexpectedly created another Operations snapshot';
  end if;

  v_replay := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_replay ->> 'ok')::boolean, false) is not true
     or coalesce((v_replay ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'immediate availability idempotent replay failed: %', v_replay;
  end if;

  select count(*) into v_count
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}';
  if v_count <> 2 then
    raise exception 'idempotent availability replay advanced configuration version';
  end if;
end $$;

do $$
declare
  v_table text;
  v_function text;
begin
  foreach v_table in array array[
    'catalog_master_categories',
    'catalog_category_shop_bindings',
    'catalog_master_products',
    'catalog_product_shop_overrides',
    'catalog_drafts',
    'catalog_draft_changes',
    'catalog_publish_versions',
    'scheduled_config_changes',
    'recurring_availability_rules'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'Admin catalog table % must have RLS enabled', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception 'Admin catalog table % leaked browser SELECT privilege', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'public.create_catalog_draft_v1(uuid,uuid,bigint,text)',
    'public.apply_catalog_draft_change_v1(uuid,uuid,bigint,jsonb)',
    'public.publish_catalog_draft_v1(uuid,uuid,bigint,bigint)',
    'public.set_immediate_product_availability_v1(uuid,uuid,uuid,boolean)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'Admin catalog RPC % leaked browser EXECUTE privilege', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Admin catalog RPC % missing service_role EXECUTE privilege', v_function;
    end if;
  end loop;
end $$;

rollback;
`;

const result = spawnSync(
  'psql',
  [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', behaviorSql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(`Admin catalog control behavioral test failed with exit code ${result.status}.`);
}

console.log('Admin catalog control static and PostgreSQL behavioral invariants passed.');

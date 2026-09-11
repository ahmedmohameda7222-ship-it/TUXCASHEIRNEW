import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910113000_admin_catalog_recurring_availability.sql';
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const name of [
  'save_recurring_availability_rule_v1',
  'materialize_recurring_availability_changes_v1',
  'apply_recurring_product_availability_v1',
  'recurring_availability',
  'africa/cairo',
]) {
  if (!sql.includes(name)) {
    throw new Error(`admin catalog recurring availability migration missing ${name}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog recurring availability static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog recurring availability behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '18000000-0000-4000-8000-000000000001';
const employeeId = '28000000-0000-4000-8000-000000000001';
const categoryId = '38000000-0000-4000-8000-000000000001';
const productId = '48000000-0000-4000-8000-000000000001';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Admin Recurring Availability Fixture', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Recurring Availability Fixture Owner', 'OWNER', true);

insert into public.menu_categories(
  id, shop_id, slug, name, description, sort_order, active
) values (
  '${categoryId}', '${shopId}', 'recurring-burgers', 'Recurring Burgers',
  'Recurring fixture category', 0, true
);

insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'recurring-burger', 'Recurring Burger',
  'Recurring fixture product', 1200, null, 'FIXTURE', false, true, false, false, 0
);

select private.sync_admin_master_catalog_v1('${businessId}', '${shopId}');

do $$
declare
  v_create jsonb;
  v_overlap jsonb;
  v_materialized jsonb;
  v_materialized_replay jsonb;
  v_enter jsonb;
  v_exit jsonb;
  v_update jsonb;
  v_stale jsonb;
  v_rule_id uuid;
  v_master_product_id uuid;
  v_count integer;
begin
  select o.master_product_id into v_master_product_id
  from public.catalog_product_shop_overrides o
  where o.shop_id = '${shopId}' and o.canonical_product_id = '${productId}';

  if v_master_product_id is null then
    raise exception 'recurring fixture missing master product mapping';
  end if;

  -- Friday 22:00 -> Saturday 02:00 is intentionally overnight.
  v_create := public.save_recurring_availability_rule_v1(
    '${employeeId}',
    '${shopId}',
    null,
    v_master_product_id,
    array[5]::smallint[],
    time '22:00',
    time '02:00',
    true,
    true,
    null
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true
     or (v_create ->> 'version')::bigint <> 1
     or v_create ->> 'timezone' <> 'Africa/Cairo' then
    raise exception 'recurring rule creation failed: %', v_create;
  end if;
  v_rule_id := (v_create ->> 'ruleId')::uuid;

  if not exists (
    select 1 from public.recurring_availability_rules r
    where r.id = v_rule_id
      and r.shop_id = '${shopId}'
      and r.master_product_id = v_master_product_id
      and r.days_of_week = array[5]::smallint[]
      and r.start_local = time '22:00'
      and r.end_local = time '02:00'
      and r.available = true
      and r.active = true
      and r.timezone = 'Africa/Cairo'
      and r.version = 1
  ) then
    raise exception 'recurring rule was not persisted canonically';
  end if;

  -- An overlapping Friday window for the same product is ambiguous and must be rejected.
  v_overlap := public.save_recurring_availability_rule_v1(
    '${employeeId}',
    '${shopId}',
    null,
    v_master_product_id,
    array[5]::smallint[],
    time '23:00',
    time '23:30',
    false,
    true,
    null
  );
  if v_overlap ->> 'code' <> 'recurring_rule_conflict' then
    raise exception 'overlapping recurring rule was not rejected: %', v_overlap;
  end if;

  -- 2026-09-11 is Friday. Materialization must retain Cairo wall-clock semantics.
  v_materialized := public.materialize_recurring_availability_changes_v1(
    timestamptz '2026-09-11 18:00:00+00',
    8
  );
  if coalesce((v_materialized ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring materialization failed: %', v_materialized;
  end if;

  if not exists (
    select 1 from public.scheduled_config_changes s
    where s.shop_id = '${shopId}'
      and s.change_kind = 'PRODUCT_AVAILABILITY'
      and s.status = 'PENDING'
      and s.timezone = 'Africa/Cairo'
      and s.local_scheduled_at = timestamp '2026-09-11 22:00:00'
      and s.scheduled_for = timestamp '2026-09-11 22:00:00' at time zone 'Africa/Cairo'
      and s.payload_json ->> 'ruleId' = v_rule_id::text
      and (s.payload_json ->> 'ruleVersion')::bigint = 1
      and s.payload_json ->> 'transition' = 'ENTER'
  ) then
    raise exception 'recurring ENTER boundary was not materialized';
  end if;

  if not exists (
    select 1 from public.scheduled_config_changes s
    where s.shop_id = '${shopId}'
      and s.change_kind = 'PRODUCT_AVAILABILITY'
      and s.local_scheduled_at = timestamp '2026-09-12 02:00:00'
      and s.scheduled_for = timestamp '2026-09-12 02:00:00' at time zone 'Africa/Cairo'
      and s.payload_json ->> 'ruleId' = v_rule_id::text
      and (s.payload_json ->> 'ruleVersion')::bigint = 1
      and s.payload_json ->> 'transition' = 'EXIT'
  ) then
    raise exception 'overnight recurring EXIT boundary was not materialized on next local day';
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes s
  where s.shop_id = '${shopId}'
    and s.change_kind = 'PRODUCT_AVAILABILITY'
    and s.payload_json ->> 'ruleId' = v_rule_id::text;

  v_materialized_replay := public.materialize_recurring_availability_changes_v1(
    timestamptz '2026-09-11 18:00:00+00',
    8
  );
  if coalesce((v_materialized_replay ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring materialization replay failed: %', v_materialized_replay;
  end if;
  if (select count(*) from public.scheduled_config_changes s
      where s.shop_id = '${shopId}'
        and s.change_kind = 'PRODUCT_AVAILABILITY'
        and s.payload_json ->> 'ruleId' = v_rule_id::text) <> v_count then
    raise exception 'recurring materialization replay duplicated durable work';
  end if;

  -- Establish a manual Sold Out baseline. Recurring ENTER must not overwrite it.
  perform public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if not exists (
    select 1 from public.catalog_product_shop_overrides o
    where o.shop_id = '${shopId}'
      and o.master_product_id = v_master_product_id
      and o.manual_sold_out = true
  ) then
    raise exception 'manual Sold Out baseline was not established';
  end if;

  v_enter := public.apply_recurring_product_availability_v1(
    '${employeeId}', '${shopId}', v_rule_id, 1, 'ENTER'
  );
  if coalesce((v_enter ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring ENTER failed: %', v_enter;
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = false
  ) then
    raise exception 'recurring available window did not make canonical product available';
  end if;
  if not exists (
    select 1 from public.catalog_product_shop_overrides o
    where o.shop_id = '${shopId}'
      and o.master_product_id = v_master_product_id
      and o.manual_sold_out = true
  ) then
    raise exception 'recurring ENTER corrupted manual Sold Out baseline';
  end if;

  v_exit := public.apply_recurring_product_availability_v1(
    '${employeeId}', '${shopId}', v_rule_id, 1, 'EXIT'
  );
  if coalesce((v_exit ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring EXIT failed: %', v_exit;
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = true
  ) then
    raise exception 'recurring EXIT did not restore current manual Sold Out baseline';
  end if;

  if not exists (
    select 1 from public.catalog_publish_versions v
    where v.shop_id = '${shopId}' and v.source_kind = 'RECURRING_AVAILABILITY'
  ) then
    raise exception 'recurring transition did not append catalog publish history';
  end if;

  -- Updating/deactivating the rule fences already-materialized old-version work.
  v_update := public.save_recurring_availability_rule_v1(
    '${employeeId}',
    '${shopId}',
    v_rule_id,
    v_master_product_id,
    array[5]::smallint[],
    time '22:00',
    time '02:00',
    true,
    false,
    1
  );
  if coalesce((v_update ->> 'ok')::boolean, false) is not true
     or (v_update ->> 'version')::bigint <> 2 then
    raise exception 'recurring rule deactivation failed: %', v_update;
  end if;

  if exists (
    select 1 from public.scheduled_config_changes s
    where s.shop_id = '${shopId}'
      and s.change_kind = 'PRODUCT_AVAILABILITY'
      and s.status in ('PENDING', 'FAILED')
      and s.payload_json ->> 'ruleId' = v_rule_id::text
      and (s.payload_json ->> 'ruleVersion')::bigint = 1
  ) then
    raise exception 'old recurring rule materializations remained runnable after rule version change';
  end if;

  v_stale := public.apply_recurring_product_availability_v1(
    '${employeeId}', '${shopId}', v_rule_id, 1, 'ENTER'
  );
  if coalesce((v_stale ->> 'ok')::boolean, false) is not true
     or coalesce((v_stale ->> 'skipped')::boolean, false) is not true then
    raise exception 'obsolete recurring execution was not a successful no-op: %', v_stale;
  end if;
end $$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.save_recurring_availability_rule_v1(uuid,uuid,uuid,uuid,smallint[],time without time zone,time without time zone,boolean,boolean,bigint)',
    'public.materialize_recurring_availability_changes_v1(timestamp with time zone,integer)',
    'public.apply_recurring_product_availability_v1(uuid,uuid,uuid,bigint,text)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'Admin recurring availability RPC % leaked browser EXECUTE privilege', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Admin recurring availability RPC % missing service_role EXECUTE privilege', v_function;
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
  throw new Error(
    `Admin catalog recurring availability behavioral test failed with exit code ${result.status}.`,
  );
}

console.log('Admin catalog recurring availability static and PostgreSQL behavioral invariants passed.');

import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog recurring deactivation PostgreSQL invariant skipped without TEST_DATABASE_URL.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog recurring deactivation test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000002';
const shopId = '18000000-0000-4000-8000-000000000002';
const employeeId = '28000000-0000-4000-8000-000000000002';
const categoryId = '38000000-0000-4000-8000-000000000002';
const productId = '48000000-0000-4000-8000-000000000002';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Recurring Deactivation Fixture', 'Africa/Cairo', 'EGP');

insert into public.shops(id, name, active)
values ('${shopId}', 'Recurring Deactivation Fixture', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Recurring Deactivation Owner', 'OWNER', true);

insert into public.menu_categories(
  id, shop_id, slug, name, description, sort_order, active
) values (
  '${categoryId}', '${shopId}', 'deactivation-burgers', 'Deactivation Burgers',
  'Recurring deactivation fixture category', 0, true
);

insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'deactivation-burger', 'Deactivation Burger',
  'Recurring deactivation fixture product', 1200, null, 'FIXTURE', false, true, false, false, 0
);

select private.sync_admin_master_catalog_v1('${businessId}', '${shopId}');

do $$
declare
  v_master_product_id uuid;
  v_create jsonb;
  v_enter jsonb;
  v_disable jsonb;
  v_rule_id uuid;
  v_history_before bigint;
  v_history_after bigint;
begin
  select o.master_product_id into v_master_product_id
  from public.catalog_product_shop_overrides o
  where o.business_id = '${businessId}'
    and o.shop_id = '${shopId}'
    and o.canonical_product_id = '${productId}';

  if v_master_product_id is null then
    raise exception 'recurring deactivation fixture missing master product mapping';
  end if;

  -- Human baseline is Sold Out. A recurring available window temporarily overrides it.
  perform public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );

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
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring deactivation rule creation failed: %', v_create;
  end if;
  v_rule_id := (v_create ->> 'ruleId')::uuid;

  v_enter := public.apply_recurring_product_availability_v1(
    '${employeeId}', '${shopId}', v_rule_id, 1, 'ENTER'
  );
  if coalesce((v_enter ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring deactivation ENTER failed: %', v_enter;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = false
  ) then
    raise exception 'recurring ENTER did not establish the temporary availability override';
  end if;

  if not exists (
    select 1 from public.catalog_product_shop_overrides o
    where o.business_id = '${businessId}'
      and o.shop_id = '${shopId}'
      and o.master_product_id = v_master_product_id
      and o.manual_sold_out = true
  ) then
    raise exception 'recurring ENTER corrupted the human manual baseline';
  end if;

  select count(*) into v_history_before
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.source_kind = 'RECURRING_AVAILABILITY';

  -- Deactivation must end an already-entered temporary window immediately. Otherwise the old
  -- EXIT is cancelled/version-fenced and the product can remain stuck in the recurring state.
  v_disable := public.save_recurring_availability_rule_v1(
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
  if coalesce((v_disable ->> 'ok')::boolean, false) is not true
     or (v_disable ->> 'version')::bigint <> 2
     or coalesce((v_disable ->> 'active')::boolean, true) is not false then
    raise exception 'recurring deactivation failed: %', v_disable;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = true
  ) then
    raise exception 'deactivating an entered recurring rule did not restore manual Sold Out baseline';
  end if;

  select count(*) into v_history_after
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.source_kind = 'RECURRING_AVAILABILITY';

  if v_history_after <= v_history_before then
    raise exception 'recurring deactivation restoration did not append immutable catalog history';
  end if;

  if exists (
    select 1 from public.scheduled_config_changes s
    where s.shop_id = '${shopId}'
      and s.change_kind = 'PRODUCT_AVAILABILITY'
      and s.status in ('PENDING', 'FAILED')
      and s.payload_json ->> 'ruleId' = v_rule_id::text
      and (s.payload_json ->> 'ruleVersion')::bigint = 1
  ) then
    raise exception 'old recurring work remained runnable after deactivation';
  end if;
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
    `Admin catalog recurring deactivation behavioral test failed with exit code ${result.status}.`,
  );
}

console.log('Admin catalog recurring deactivation PostgreSQL invariant passed.');

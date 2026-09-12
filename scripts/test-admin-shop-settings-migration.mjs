import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910120000_admin_shop_settings.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error('admin shop settings migration is missing');
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
const requiredObjects = [
  'business_setting_defaults',
  'shop_setting_overrides',
  'shop_settings_versions',
  'admin_reason_codes',
  'payment_method_zone_rules',
  'shop_weekly_hours',
  'shop_special_hours',
  'resolve_effective_shop_setting_v1',
  'publish_shop_settings_v1',
  'delete_or_archive_shop_v1',
  'update_admin_order_type_v1',
  'update_admin_payment_method_v1',
  'build_admin_catalog_bundle_v1',
];
for (const name of requiredObjects) {
  if (!sql.includes(name)) throw new Error(`admin shop settings migration missing ${name}`);
}
for (const fragment of [
  'lifecycle_state',
  'edit_version',
  'channel',
  'requires_reference',
  'manual_confirmation_required',
  'refund_allowed',
  'africa/cairo',
]) {
  if (!sql.includes(fragment)) throw new Error(`admin shop settings migration missing ${fragment}`);
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin shop settings migration static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin shop settings behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '17000000-0000-4000-8000-000000000001';
const unusedShopId = '17000000-0000-4000-8000-000000000002';
const employeeId = '27000000-0000-4000-8000-000000000001';
const orderTypeId = '32000000-0000-4000-8000-000000000001';
const paymentMethodId = '37000000-0000-4000-8000-000000000001';
const zoneId = '47000000-0000-4000-8000-000000000001';
const reasonCodeId = '57000000-0000-4000-8000-000000000001';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values
  ('${shopId}', 'Settings Fixture', true),
  ('${unusedShopId}', 'Unused Settings Fixture', true);

insert into public.business_shops(business_id, shop_id)
values
  ('${businessId}', '${shopId}'),
  ('${businessId}', '${unusedShopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Settings Fixture Owner', 'OWNER', true);

insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
values ('${orderTypeId}', '${shopId}', 'Take Away', 'TAKE_AWAY', true, 0);

insert into public.payment_methods(
  id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order,
  channel, requires_reference, manual_confirmation_required, refund_allowed
) values (
  '${paymentMethodId}', '${shopId}', 'Cash', 'CASH', true, true, 0,
  'POS', false, false, true
);

insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order)
values ('${zoneId}', '${shopId}', 'Fixture Zone', 2500, true, 0);

insert into public.payment_method_zone_rules(
  business_id, shop_id, payment_method_id, delivery_zone_id, allowed
) values ('${businessId}', '${shopId}', '${paymentMethodId}', '${zoneId}', false);

insert into public.business_setting_defaults(
  business_id, setting_key, value_json, version, updated_by_employee_id
) values
  ('${businessId}', 'checkout.minimumOrderMinor', '1000'::jsonb, 1, '${employeeId}'),
  ('${businessId}', 'checkout.serviceChargeBps', '500'::jsonb, 1, '${employeeId}'),
  ('${businessId}', 'checkout.taxBps', '1400'::jsonb, 1, '${employeeId}'),
  ('${businessId}', 'receipt.footer', '"Business footer"'::jsonb, 1, '${employeeId}'),
  ('${businessId}', 'receipt.orderPrefix', '"TUX-"'::jsonb, 1, '${employeeId}');

insert into public.shop_setting_overrides(
  business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
) values
  ('${businessId}', '${shopId}', 'checkout.minimumOrderMinor', '1500'::jsonb, 1, '${employeeId}'),
  ('${businessId}', '${shopId}', 'receipt.orderPrefix', '"FX-"'::jsonb, 1, '${employeeId}');

insert into public.admin_reason_codes(
  id, business_id, shop_id, reason_key, family, label, active, version, updated_by_employee_id
) values (
  '${reasonCodeId}', '${businessId}', null, 'customer-request', 'CANCELLATION',
  'Customer request', true, 1, '${employeeId}'
);

insert into public.shop_weekly_hours(
  business_id, shop_id, service_kind, day_of_week, opens_local, closes_local, active
) values ('${businessId}', '${shopId}', 'OPEN', 5, '10:00', '02:00', true);

insert into public.shop_special_hours(
  business_id, shop_id, service_date, service_kind, closed, opens_local, closes_local, note
) values ('${businessId}', '${shopId}', date '2026-09-29', 'OPEN', false, '12:00', '23:00', 'Graduation day hours');

do $$
declare
  v_resolved jsonb;
  v_order_edit jsonb;
  v_payment_edit jsonb;
  v_publish jsonb;
  v_first_bundle jsonb;
  v_second_bundle jsonb;
  v_catalog_bundle jsonb;
  v_archive jsonb;
  v_delete jsonb;
  v_reason_failed boolean := false;
  v_logic_type text;
  v_requires_reconciliation boolean;
begin
  v_order_edit := public.update_admin_order_type_v1(
    '${employeeId}', '${shopId}', '${orderTypeId}', 'Pick up', 'TAKE_AWAY', true, 1, 0, 1
  );
  if coalesce((v_order_edit ->> 'ok')::boolean, false) is not true
     or (v_order_edit ->> 'editVersion')::bigint <> 2 then
    raise exception 'order type edit failed: %', v_order_edit;
  end if;

  v_order_edit := public.update_admin_order_type_v1(
    '${employeeId}', '${shopId}', '${orderTypeId}', 'Stale edit', 'TAKE_AWAY', true, 2, 0, 1
  );
  if v_order_edit ->> 'code' <> 'stale_edit_version'
     or (v_order_edit ->> 'currentVersion')::bigint <> 2 then
    raise exception 'stale order type row edit was not rejected: %', v_order_edit;
  end if;

  v_payment_edit := public.update_admin_payment_method_v1(
    '${employeeId}', '${shopId}', '${paymentMethodId}', 'Front Cash', true, 1,
    'BOTH', true, true, false, 0, 1
  );
  if coalesce((v_payment_edit ->> 'ok')::boolean, false) is not true
     or (v_payment_edit ->> 'editVersion')::bigint <> 2 then
    raise exception 'payment method edit failed: %', v_payment_edit;
  end if;

  select p.logic_type, p.requires_reconciliation
    into v_logic_type, v_requires_reconciliation
  from public.payment_methods p
  where p.id = '${paymentMethodId}' and p.shop_id = '${shopId}';
  if v_logic_type <> 'CASH' or v_requires_reconciliation is not true then
    raise exception 'Admin payment edit changed protected operational semantics';
  end if;

  v_resolved := public.resolve_effective_shop_setting_v1(
    '${businessId}', '${shopId}', 'checkout.minimumOrderMinor'
  );
  if v_resolved ->> 'source' <> 'shop' or (v_resolved -> 'value')::integer <> 1500 then
    raise exception 'shop override did not win over business default: %', v_resolved;
  end if;

  v_resolved := public.resolve_effective_shop_setting_v1(
    '${businessId}', '${shopId}', 'checkout.taxBps'
  );
  if v_resolved ->> 'source' <> 'business' or (v_resolved -> 'value')::integer <> 1400 then
    raise exception 'business default was not inherited: %', v_resolved;
  end if;

  v_publish := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 0);
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'settingsVersion')::bigint <> 1
     or (v_publish ->> 'operationsConfigurationVersion')::integer <> 1 then
    raise exception 'first settings publish failed: %', v_publish;
  end if;

  v_order_edit := public.update_admin_order_type_v1(
    '${employeeId}', '${shopId}', '${orderTypeId}', 'Wrong base', 'TAKE_AWAY', true, 2, 0, 2
  );
  if v_order_edit ->> 'code' <> 'stale_settings_version'
     or (v_order_edit ->> 'currentVersion')::bigint <> 1 then
    raise exception 'stale published settings base was not rejected: %', v_order_edit;
  end if;

  select s.bundle_json into v_first_bundle
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' and s.version = 1;

  if v_first_bundle #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' <> '1500'
     or v_first_bundle #>> '{snapshot,settings,values,checkout.taxBps}' <> '1400'
     or v_first_bundle #>> '{snapshot,settings,values,receipt.orderPrefix}' <> 'FX-'
     or v_first_bundle #>> '{snapshot,orderTypes,0,name}' <> 'Pick up'
     or v_first_bundle #>> '{snapshot,paymentMethods,0,displayName}' <> 'Front Cash'
     or v_first_bundle #>> '{snapshot,paymentMethods,0,channel}' <> 'BOTH'
     or v_first_bundle #>> '{snapshot,reasonCodes,0,family}' <> 'CANCELLATION'
     or v_first_bundle #>> '{snapshot,reasonCodes,0,label}' <> 'Customer request' then
    raise exception 'published Operations settings snapshot is incomplete: %', v_first_bundle;
  end if;

  update public.business_setting_defaults
  set value_json = '1600'::jsonb, version = version + 1, updated_at = now()
  where business_id = '${businessId}' and setting_key = 'checkout.minimumOrderMinor';

  v_publish := public.publish_shop_settings_v1('${employeeId}', '${shopId}', 1);
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'settingsVersion')::bigint <> 2
     or (v_publish ->> 'operationsConfigurationVersion')::integer <> 2 then
    raise exception 'second settings publish failed: %', v_publish;
  end if;

  select s.bundle_json into v_second_bundle
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' and s.version = 2;

  if v_second_bundle #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' <> '1500' then
    raise exception 'shop override stopped winning after default edit';
  end if;
  if (
    select s.bundle_json from public.operations_configuration_snapshots s
    where s.shop_id = '${shopId}' and s.version = 1
  ) is distinct from v_first_bundle then
    raise exception 'historical settings snapshot was mutated';
  end if;

  v_catalog_bundle := private.build_admin_catalog_bundle_v1('${shopId}', 3, now());
  if v_catalog_bundle #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' <> '1500'
     or v_catalog_bundle #>> '{snapshot,settings,values,receipt.orderPrefix}' <> 'FX-'
     or v_catalog_bundle #>> '{snapshot,paymentMethods,0,channel}' <> 'BOTH' then
    raise exception 'catalog bundle builder dropped published settings authority: %', v_catalog_bundle;
  end if;

  begin
    insert into public.admin_reason_codes(
      business_id, shop_id, reason_key, family, label, active, version, updated_by_employee_id
    ) values (
      '${businessId}', null, 'bad-family', 'FREE_TEXT', 'Bad family', true, 1, '${employeeId}'
    );
  exception when check_violation then
    v_reason_failed := true;
  end;
  if not v_reason_failed then
    raise exception 'reason family constraint accepted an unreviewed family';
  end if;

  v_archive := public.delete_or_archive_shop_v1('${employeeId}', '${shopId}');
  if v_archive ->> 'action' <> 'ARCHIVED' then
    raise exception 'used shop was not archived: %', v_archive;
  end if;
  if not exists (
    select 1 from public.shops s
    where s.id = '${shopId}' and s.lifecycle_state = 'ARCHIVED' and s.active = false
  ) then
    raise exception 'archived shop canonical row was not retained';
  end if;

  v_delete := public.delete_or_archive_shop_v1('${employeeId}', '${unusedShopId}');
  if v_delete ->> 'action' <> 'DELETED' then
    raise exception 'unused shop was not deleted: %', v_delete;
  end if;
  if exists (select 1 from public.shops s where s.id = '${unusedShopId}') then
    raise exception 'unused shop row still exists after delete';
  end if;
end $$;

do $$
declare
  v_table text;
  v_function text;
begin
  foreach v_table in array array[
    'business_setting_defaults',
    'shop_setting_overrides',
    'shop_settings_versions',
    'admin_reason_codes',
    'payment_method_zone_rules',
    'shop_weekly_hours',
    'shop_special_hours'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'Admin settings table % must have RLS enabled', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') then
      raise exception 'Admin settings table % leaked browser SELECT access', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'resolve_effective_shop_setting_v1(uuid,uuid,text)',
    'publish_shop_settings_v1(uuid,uuid,bigint)',
    'delete_or_archive_shop_v1(uuid,uuid)',
    'update_admin_order_type_v1(uuid,uuid,uuid,text,text,boolean,integer,bigint,bigint)',
    'update_admin_payment_method_v1(uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,boolean,bigint,bigint)'
  ] loop
    if has_function_privilege('anon', 'public.' || v_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || v_function, 'EXECUTE') then
      raise exception 'Admin settings function % leaked browser EXECUTE access', v_function;
    end if;
  end loop;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-c', behaviorSql], {
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Admin shop settings migration PostgreSQL behavior passed.');

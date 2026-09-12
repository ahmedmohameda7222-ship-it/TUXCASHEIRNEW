-- TUX Admin Plan 2 review hardening: close the trusted settings command surface to
-- reviewed setting keys and key-specific value schemas. Repository migration only.

create or replace function private.validate_admin_setting_value_v1(
  p_setting_key text,
  p_value_json jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_number numeric;
  v_text text;
begin
  if p_setting_key is null or p_value_json is null then
    return false;
  end if;

  case p_setting_key
    when 'checkout.minimumOrderMinor' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 9007199254740991;

    when 'checkout.serviceChargeBps', 'checkout.taxBps' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 10000;

    when 'checkout.requireCustomerPhone', 'checkout.allowScheduledOrders' then
      return jsonb_typeof(p_value_json) = 'boolean';

    when 'receipt.orderPrefix' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 64;

    when 'receipt.footer' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 1000;

    when 'receipt.sequenceStart' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 1 and 9007199254740991;

    when 'receipt.sequenceResetPolicy' then
      return jsonb_typeof(p_value_json) = 'string'
        and (p_value_json #>> '{}') = 'BUSINESS_DAY';

    else
      return false;
  end case;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.validate_admin_setting_value_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function private.validate_admin_setting_value_v1(text, jsonb)
  to service_role;

create or replace function public.upsert_business_setting_default_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_setting_key text,
  p_value_json jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_version bigint;
  v_next_version bigint;
begin
  if not private.validate_admin_setting_value_v1(p_setting_key, p_value_json) then
    return jsonb_build_object('ok', false, 'code', 'invalid_setting');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-setting-default:' || v_business_id::text || ':' || p_setting_key, 0)
  );

  select s.version into v_current_version
  from public.business_setting_defaults s
  where s.business_id = v_business_id and s.setting_key = p_setting_key
  for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_current_version then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_setting_version',
        'currentVersion', v_current_version
      );
    end if;
    v_next_version := v_current_version + 1;
    update public.business_setting_defaults
    set value_json = p_value_json,
        version = v_next_version,
        updated_by_employee_id = p_employee_id,
        updated_at = now()
    where business_id = v_business_id and setting_key = p_setting_key;
  else
    if p_expected_version is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_setting_version',
        'currentVersion', 0
      );
    end if;
    v_next_version := 1;
    insert into public.business_setting_defaults(
      business_id, setting_key, value_json, version, updated_by_employee_id
    ) values (
      v_business_id, p_setting_key, p_value_json, v_next_version, p_employee_id
    );
  end if;

  return jsonb_build_object('ok', true, 'version', v_next_version);
end;
$$;
revoke all on function public.upsert_business_setting_default_v1(uuid, uuid, text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.upsert_business_setting_default_v1(uuid, uuid, text, jsonb, bigint)
  to service_role;

create or replace function public.upsert_shop_setting_override_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_setting_key text,
  p_value_json jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_version bigint;
  v_next_version bigint;
begin
  if not private.validate_admin_setting_value_v1(p_setting_key, p_value_json) then
    return jsonb_build_object('ok', false, 'code', 'invalid_setting');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-setting-override:' || p_shop_id::text || ':' || p_setting_key, 0)
  );

  select s.version into v_current_version
  from public.shop_setting_overrides s
  where s.business_id = v_business_id
    and s.shop_id = p_shop_id
    and s.setting_key = p_setting_key
  for update;

  if found then
    if p_expected_version is null or p_expected_version <> v_current_version then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_setting_version',
        'currentVersion', v_current_version
      );
    end if;
    v_next_version := v_current_version + 1;
    update public.shop_setting_overrides
    set value_json = p_value_json,
        version = v_next_version,
        updated_by_employee_id = p_employee_id,
        updated_at = now()
    where business_id = v_business_id
      and shop_id = p_shop_id
      and setting_key = p_setting_key;
  else
    if p_expected_version is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_setting_version',
        'currentVersion', 0
      );
    end if;
    v_next_version := 1;
    insert into public.shop_setting_overrides(
      business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
    ) values (
      v_business_id, p_shop_id, p_setting_key, p_value_json, v_next_version, p_employee_id
    );
  end if;

  return jsonb_build_object('ok', true, 'version', v_next_version);
end;
$$;
revoke all on function public.upsert_shop_setting_override_v1(uuid, uuid, text, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.upsert_shop_setting_override_v1(uuid, uuid, text, jsonb, bigint)
  to service_role;

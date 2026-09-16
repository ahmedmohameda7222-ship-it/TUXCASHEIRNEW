-- Version-fenced trusted mutation commands for Admin settings management.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.

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
  if p_setting_key is null or p_setting_key !~ '^[A-Za-z][A-Za-z0-9_.-]*$' or p_value_json is null then
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
  if p_setting_key is null or p_setting_key !~ '^[A-Za-z][A-Za-z0-9_.-]*$' or p_value_json is null then
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

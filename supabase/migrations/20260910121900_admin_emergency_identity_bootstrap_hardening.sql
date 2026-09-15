-- TUX Admin Plan 2 emergency rollout identity hardening.
-- Additive only: preserve immutable published settings while bootstrapping a complete trusted
-- shop identity for pre-Plan-2 Operations snapshots before patching emergency state flags.

create or replace function public.update_admin_shop_operational_state_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_temporary_closed boolean,
  p_online_orders_paused boolean,
  p_expected_settings_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_operations_version integer;
  v_next_settings_version bigint;
  v_next_operations_version integer;
  v_lifecycle_state text;
  v_trusted_shop_identity jsonb;
  v_previous_settings jsonb;
  v_previous_bundle jsonb;
  v_previous_shop_identity jsonb;
  v_settings_payload jsonb;
  v_now timestamptz := now();
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_temporary_closed is null
     or p_online_orders_paused is null
     or p_expected_settings_version is null
     or p_expected_settings_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_operational_state_command');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id,
    p_shop_id,
    'settings.manage'
  );
  if v_business_id is null then
    raise exception 'TUX_ADMIN_SETTINGS_PERMISSION_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select
    s.lifecycle_state,
    jsonb_build_object(
      'shopId', s.id,
      'displayName', s.name,
      'address', s.address_text,
      'phone', s.contact_phone,
      'latitude', s.latitude,
      'longitude', s.longitude,
      'timezone', s.timezone,
      'lifecycleState', s.lifecycle_state,
      'temporaryClosed', s.temporary_closed,
      'onlineOrdersPaused', s.online_orders_paused
    )
    into v_lifecycle_state, v_trusted_shop_identity
  from public.shops s
  where s.id = p_shop_id
  for update;

  if not found or v_lifecycle_state = 'ARCHIVED' then
    return jsonb_build_object('ok', false, 'code', 'shop_archived_or_missing');
  end if;

  select coalesce(max(version.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions version
  where version.shop_id = p_shop_id;

  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  select snapshot.version, snapshot.bundle_json
    into v_current_operations_version, v_previous_bundle
  from public.operations_configuration_snapshots snapshot
  where snapshot.shop_id = p_shop_id
  order by snapshot.version desc
  limit 1;

  v_current_operations_version := coalesce(v_current_operations_version, 0);
  v_next_settings_version := v_current_settings_version + 1;
  v_next_operations_version := v_current_operations_version + 1;

  -- Emergency state must never rebuild from mutable Admin settings/default rows. Start from the
  -- latest immutable Operations bundle. A pre-Plan-2 bundle may not have snapshot.settings yet,
  -- so the rollout fallback uses only the locked canonical shop row for the required identity.
  if v_previous_bundle is null then
    v_previous_bundle := private.build_admin_catalog_core_bundle_v1(
      p_shop_id,
      v_next_operations_version,
      v_now
    );
  end if;

  v_previous_settings := coalesce(
    v_previous_bundle #> '{snapshot,settings}',
    jsonb_build_object(
      'version', v_current_settings_version,
      'values', '{}'::jsonb,
      'shopIdentity', '{}'::jsonb,
      'weeklyHours', '[]'::jsonb,
      'specialHours', '[]'::jsonb,
      'paymentMethodZoneRules', '[]'::jsonb
    )
  );

  -- The immutable identity wins for every field it already published. The trusted shop baseline
  -- fills only missing rollout fields, including snapshots created before Plan 2 or by the earlier
  -- incomplete emergency fallback. No mutable setting override/default/reason rows are consulted.
  v_previous_shop_identity := v_trusted_shop_identity
    || coalesce(v_previous_settings -> 'shopIdentity', '{}'::jsonb);
  v_previous_shop_identity := jsonb_set(
    v_previous_shop_identity,
    '{temporaryClosed}',
    to_jsonb(p_temporary_closed),
    true
  );
  v_previous_shop_identity := jsonb_set(
    v_previous_shop_identity,
    '{onlineOrdersPaused}',
    to_jsonb(p_online_orders_paused),
    true
  );
  v_previous_settings := jsonb_set(
    v_previous_settings,
    '{version}',
    to_jsonb(v_next_settings_version),
    true
  );
  v_previous_settings := jsonb_set(
    v_previous_settings,
    '{shopIdentity}',
    v_previous_shop_identity,
    true
  );

  v_previous_bundle := jsonb_set(
    v_previous_bundle,
    '{snapshot,version}',
    to_jsonb(v_next_operations_version),
    true
  );
  v_previous_bundle := jsonb_set(
    v_previous_bundle,
    '{snapshot,updatedAt}',
    to_jsonb(v_now),
    true
  );
  v_previous_bundle := jsonb_set(
    v_previous_bundle,
    '{snapshot,settings}',
    v_previous_settings,
    true
  );

  v_settings_payload := jsonb_build_object(
    'settings', v_previous_settings,
    'orderTypes', coalesce(v_previous_bundle #> '{snapshot,orderTypes}', '[]'::jsonb),
    'paymentMethods', coalesce(v_previous_bundle #> '{snapshot,paymentMethods}', '[]'::jsonb),
    'deliveryZones', coalesce(v_previous_bundle #> '{snapshot,deliveryZones}', '[]'::jsonb),
    'reasonCodes', coalesce(v_previous_bundle #> '{snapshot,reasonCodes}', '[]'::jsonb)
  );

  update public.shops
  set temporary_closed = p_temporary_closed,
      online_orders_paused = p_online_orders_paused,
      updated_at = v_now
  where id = p_shop_id;

  insert into public.operations_configuration_snapshots(
    shop_id,
    version,
    bundle_json,
    published_at,
    published_by_auth_user_id
  ) values (
    p_shop_id,
    v_next_operations_version,
    v_previous_bundle,
    v_now,
    null
  );

  insert into public.shop_settings_versions(
    business_id,
    shop_id,
    settings_version,
    operations_configuration_version,
    settings_json,
    bundle_json,
    published_by_employee_id,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_next_settings_version,
    v_next_operations_version,
    v_settings_payload,
    v_previous_bundle,
    p_employee_id,
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'settingsVersion', v_next_settings_version,
    'operationsConfigurationVersion', v_next_operations_version
  );
end;
$$;

revoke all on function public.update_admin_shop_operational_state_v1(uuid, uuid, boolean, boolean, bigint)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.update_admin_shop_operational_state_v1(
      uuid, uuid, boolean, boolean, bigint
    ) to service_role;
  end if;
end $$;

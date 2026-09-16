-- TUX Admin Plan 2 round 14 sequencing follow-up.
-- A later accepted SHOP_CONFIG action may rebase over any earlier scheduled SHOP_CONFIG
-- publication or emergency patch, while ordinary/manual settings publication remains a stale barrier.

create or replace function public.apply_scheduled_shop_config_change_v1(
  p_change_id uuid,
  p_idempotency_key text,
  p_attempt_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_change public.scheduled_config_changes%rowtype;
  v_existing public.shop_settings_versions%rowtype;
  v_current_settings_version bigint;
  v_current_operations_version integer;
  v_next_settings_version bigint;
  v_next_operations_version integer;
  v_target_base_settings_version bigint;
  v_operation text;
  v_payload jsonb;
  v_current_payload jsonb;
  v_base jsonb;
  v_bundle jsonb;
  v_online_orders_paused boolean;
  v_current_temporary_closed jsonb;
  v_current_online_orders_paused jsonb;
  v_now timestamptz := now();
begin
  if p_change_id is null or nullif(btrim(p_idempotency_key), '') is null
     or p_attempt_count is null or p_attempt_count < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_execution');
  end if;

  select * into v_change
  from public.scheduled_config_changes s
  where s.id = p_change_id
  for update;
  if not found or v_change.change_kind <> 'SHOP_CONFIG'
     or v_change.idempotency_key <> p_idempotency_key
     or v_change.status <> 'CLAIMED'
     or v_change.attempt_count <> p_attempt_count then
    return jsonb_build_object('ok', false, 'code', 'shop_config_claim_mismatch');
  end if;

  select * into v_existing
  from public.shop_settings_versions v
  where v.scheduled_change_id = p_change_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'settingsVersion', v_existing.settings_version,
      'operationsConfigurationVersion', v_existing.operations_configuration_version,
      'replayed', true
    );
  end if;

  v_operation := v_change.payload_json ->> 'operation';
  v_payload := v_change.payload_json -> 'settingsPayload';
  v_target_base_settings_version := (v_change.payload_json ->> 'targetBaseSettingsVersion')::bigint;
  if v_operation not in ('PUBLISH_SETTINGS', 'ONLINE_ORDERS_STATE')
     or jsonb_typeof(v_payload) <> 'object'
     or v_target_base_settings_version is null or v_target_base_settings_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_payload');
  end if;

  if (v_payload #>> '{settings,version}')::bigint <> v_target_base_settings_version + 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_snapshot_version');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_change.shop_id::text, 0));

  select coalesce(max(v.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions v
  where v.shop_id = v_change.shop_id;

  if v_current_settings_version < v_target_base_settings_version
     or exists (
       select 1
       from public.shop_settings_versions lineage
       where lineage.shop_id = v_change.shop_id
         and lineage.settings_version > v_target_base_settings_version
         and lineage.settings_version <= v_current_settings_version
         and lineage.settings_publication_kind not in (
           'EMERGENCY_OPERATIONAL_STATE',
           'SCHEDULED_SETTINGS_PUBLISH',
           'SCHEDULED_ONLINE_ORDERS_STATE'
         )
     ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  select v.settings_json
    into v_current_payload
  from public.shop_settings_versions v
  where v.shop_id = v_change.shop_id
  order by v.settings_version desc
  limit 1;

  v_next_settings_version := v_current_settings_version + 1;

  if v_operation = 'PUBLISH_SETTINGS' then
    if v_current_payload is not null then
      v_current_temporary_closed := v_current_payload #> '{settings,shopIdentity,temporaryClosed}';
      v_current_online_orders_paused := v_current_payload #> '{settings,shopIdentity,onlineOrdersPaused}';
      if v_current_temporary_closed is not null then
        v_payload := jsonb_set(
          v_payload,
          '{settings,shopIdentity,temporaryClosed}',
          v_current_temporary_closed,
          true
        );
      end if;
      if v_current_online_orders_paused is not null then
        v_payload := jsonb_set(
          v_payload,
          '{settings,shopIdentity,onlineOrdersPaused}',
          v_current_online_orders_paused,
          true
        );
      end if;
    end if;
  else
    v_payload := coalesce(v_current_payload, v_payload);
    v_online_orders_paused := (v_change.payload_json ->> 'onlineOrdersPaused')::boolean;
    if v_online_orders_paused is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_payload');
    end if;
    v_payload := jsonb_set(
      v_payload,
      '{settings,shopIdentity,onlineOrdersPaused}',
      to_jsonb(v_online_orders_paused),
      true
    );
  end if;

  v_payload := jsonb_set(
    v_payload,
    '{settings,version}',
    to_jsonb(v_next_settings_version),
    true
  );

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_change.shop_id;
  v_next_operations_version := v_current_operations_version + 1;

  v_base := private.build_admin_catalog_core_bundle_v1(
    v_change.shop_id, v_next_operations_version, v_now
  );
  v_bundle := private.merge_admin_settings_bundle_v1(v_base, v_payload);

  if v_operation = 'ONLINE_ORDERS_STATE' then
    update public.shops
    set online_orders_paused = v_online_orders_paused,
        updated_at = v_now
    where id = v_change.shop_id and lifecycle_state <> 'ARCHIVED';
    if not found then
      return jsonb_build_object('ok', false, 'code', 'shop_archived_or_missing');
    end if;
  elsif not exists (
    select 1 from public.shops s
    where s.id = v_change.shop_id and s.lifecycle_state <> 'ARCHIVED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_archived_or_missing');
  end if;

  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values (
    v_change.shop_id, v_next_operations_version, v_bundle, v_now, null
  );

  insert into public.shop_settings_versions(
    business_id, shop_id, settings_version, operations_configuration_version,
    settings_json, bundle_json, published_by_employee_id, published_at, scheduled_change_id,
    settings_publication_kind
  ) values (
    v_change.business_id,
    v_change.shop_id,
    v_next_settings_version,
    v_next_operations_version,
    v_payload,
    v_bundle,
    v_change.created_by_employee_id,
    v_now,
    v_change.id,
    case
      when v_operation = 'PUBLISH_SETTINGS' then 'SCHEDULED_SETTINGS_PUBLISH'
      else 'SCHEDULED_ONLINE_ORDERS_STATE'
    end
  );

  return jsonb_build_object(
    'ok', true,
    'settingsVersion', v_next_settings_version,
    'operationsConfigurationVersion', v_next_operations_version
  );
end;
$$;

revoke all on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer)
      to service_role;
  end if;
end $$;

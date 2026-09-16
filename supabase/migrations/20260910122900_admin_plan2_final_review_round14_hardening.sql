-- TUX Admin Plan 2 final review round 14 hardening.
-- Additive only: preserve accepted SHOP_CONFIG schedules across emergency/patch publications,
-- allow independent future shop-config jobs to coexist, and record publication lineage explicitly.

alter table public.shop_settings_versions
  add column if not exists settings_publication_kind text not null default 'SETTINGS_PUBLISH';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.shop_settings_versions'::regclass
      and c.conname = 'shop_settings_versions_publication_kind_ck'
  ) then
    alter table public.shop_settings_versions
      add constraint shop_settings_versions_publication_kind_ck
      check (settings_publication_kind in (
        'SETTINGS_PUBLISH',
        'EMERGENCY_OPERATIONAL_STATE',
        'SCHEDULED_SETTINGS_PUBLISH',
        'SCHEDULED_ONLINE_ORDERS_STATE'
      ));
  end if;
end $$;

-- Emergency publication is a patch-like settings publication. Mark it explicitly so an already
-- accepted future SHOP_CONFIG action can rebase over it without treating an ordinary settings
-- publication as safe transient lineage.
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
    published_at,
    settings_publication_kind
  ) values (
    v_business_id,
    p_shop_id,
    v_next_settings_version,
    v_next_operations_version,
    v_settings_payload,
    v_previous_bundle,
    p_employee_id,
    v_now,
    'EMERGENCY_OPERATIONAL_STATE'
  );

  return jsonb_build_object(
    'ok', true,
    'settingsVersion', v_next_settings_version,
    'operationsConfigurationVersion', v_next_operations_version
  );
end;
$$;

-- Every explicit request is an independent future action unless it is an exact idempotent replay.
-- Do not silently cancel other pending SHOP_CONFIG jobs for the shop.
create or replace function private.schedule_admin_shop_config_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_operation text,
  p_settings_payload jsonb,
  p_online_orders_paused boolean,
  p_expected_settings_version bigint,
  p_local_scheduled_at timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_scheduled_for timestamptz;
  v_idempotency_key text;
  v_existing public.scheduled_config_changes%rowtype;
  v_schedule_id uuid;
begin
  if p_employee_id is null or p_shop_id is null
     or p_operation not in ('PUBLISH_SETTINGS', 'ONLINE_ORDERS_STATE')
     or p_expected_settings_version is null or p_expected_settings_version < 0
     or p_local_scheduled_at is null
     or jsonb_typeof(p_settings_payload) <> 'object'
     or jsonb_typeof(p_settings_payload -> 'settings') <> 'object'
     or (p_operation = 'ONLINE_ORDERS_STATE' and p_online_orders_paused is null)
     or (p_operation = 'PUBLISH_SETTINGS' and p_online_orders_paused is not null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_schedule');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  if not exists (
    select 1 from public.shops s
    where s.id = p_shop_id and s.lifecycle_state <> 'ARCHIVED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_archived_or_missing');
  end if;

  select coalesce(max(v.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions v
  where v.shop_id = p_shop_id;

  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  if (p_settings_payload #>> '{settings,version}')::bigint <> v_current_settings_version + 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_snapshot_version');
  end if;

  if p_local_scheduled_at <= (now() at time zone 'Africa/Cairo') then
    return jsonb_build_object('ok', false, 'code', 'scheduled_time_must_be_future');
  end if;
  v_scheduled_for := p_local_scheduled_at at time zone 'Africa/Cairo';
  v_idempotency_key := format(
    'shop-config:%s:%s:%s:%s:%s',
    p_shop_id,
    p_operation,
    p_expected_settings_version,
    coalesce(p_online_orders_paused::text, 'settings'),
    to_char(p_local_scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
  );

  select * into v_existing
  from public.scheduled_config_changes s
  where s.idempotency_key = v_idempotency_key
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'ok', true,
      'scheduleId', v_existing.id,
      'status', v_existing.status,
      'scheduledFor', v_existing.scheduled_for,
      'localScheduledAt', v_existing.local_scheduled_at,
      'timezone', v_existing.timezone,
      'idempotentReplay', true
    );
  end if;

  insert into public.scheduled_config_changes(
    business_id, shop_id, created_by_employee_id, change_kind, payload_json,
    timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
    idempotency_key, status
  ) values (
    v_business_id,
    p_shop_id,
    p_employee_id,
    'SHOP_CONFIG',
    jsonb_build_object(
      'operation', p_operation,
      'settingsPayload', p_settings_payload,
      'onlineOrdersPaused', p_online_orders_paused,
      'targetBaseSettingsVersion', p_expected_settings_version
    ),
    'Africa/Cairo',
    p_local_scheduled_at,
    v_scheduled_for,
    null,
    v_idempotency_key,
    'PENDING'
  ) returning id into v_schedule_id;

  return jsonb_build_object(
    'ok', true,
    'scheduleId', v_schedule_id,
    'status', 'PENDING',
    'scheduledFor', v_scheduled_for,
    'localScheduledAt', p_local_scheduled_at,
    'timezone', 'Africa/Cairo'
  );
end;
$$;

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

  -- The stored acceptance snapshot must still represent target-base + 1 even when execution later
  -- rebases over emergency/online-state patch publications.
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
           'EMERGENCY_OPERATIONAL_STATE', 'SCHEDULED_ONLINE_ORDERS_STATE'
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
    -- Full scheduled settings keep their accepted non-emergency intent, but an emergency action
    -- taken after acceptance remains authoritative at activation time.
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
    -- Online pause/resume is a patch operation. Rebase it on the latest safe published payload,
    -- then apply only the requested online-order state.
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

revoke all on function public.update_admin_shop_operational_state_v1(uuid, uuid, boolean, boolean, bigint)
  from public, anon, authenticated;
revoke all on function private.schedule_admin_shop_config_v1(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) from public, anon, authenticated;
revoke all on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.update_admin_shop_operational_state_v1(
      uuid, uuid, boolean, boolean, bigint
    ) to service_role;
    grant execute on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer)
      to service_role;
  end if;
end $$;

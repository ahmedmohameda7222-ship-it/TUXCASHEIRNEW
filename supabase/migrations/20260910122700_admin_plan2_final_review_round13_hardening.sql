-- TUX Admin Plan 2 final review round 13 hardening.
-- Additive only: make the already-approved SHOP_CONFIG schedule kind durable, claimable and replay-safe.
-- Settings schedules snapshot validated settings-owned state at acceptance; execution never re-reads mutable
-- staged settings and never re-authorizes the historical creator.

alter table public.shop_settings_versions
  add column if not exists scheduled_change_id uuid references public.scheduled_config_changes(id) on delete restrict;

create unique index if not exists shop_settings_versions_scheduled_change_uidx
  on public.shop_settings_versions(scheduled_change_id)
  where scheduled_change_id is not null;

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
  where s.shop_id = p_shop_id
    and s.change_kind = 'SHOP_CONFIG'
    and s.status in ('PENDING', 'FAILED', 'CLAIMED')
  order by case when s.status = 'CLAIMED' then 0 else 1 end, s.created_at desc, s.id
  limit 1
  for update;

  if found then
    if v_existing.idempotency_key = v_idempotency_key then
      return jsonb_build_object(
        'ok', true,
        'scheduleId', v_existing.id,
        'status', v_existing.status,
        'scheduledFor', v_scheduled_for,
        'localScheduledAt', p_local_scheduled_at,
        'timezone', 'Africa/Cairo',
        'idempotentReplay', true
      );
    end if;
    if v_existing.status = 'CLAIMED' then
      return jsonb_build_object('ok', false, 'code', 'schedule_claimed', 'scheduleId', v_existing.id);
    end if;

    update public.scheduled_config_changes s
    set status = 'CANCELLED',
        claimed_at = null,
        next_attempt_at = null,
        terminal_failure = false,
        last_error = 'replaced_by_reschedule',
        updated_at = now()
    where s.shop_id = p_shop_id
      and s.change_kind = 'SHOP_CONFIG'
      and s.status in ('PENDING', 'FAILED');
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

revoke all on function private.schedule_admin_shop_config_v1(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) from public, anon, authenticated;

create or replace function public.schedule_shop_settings_publish_v1(
  p_employee_id uuid,
  p_shop_id uuid,
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
  v_payload jsonb;
begin
  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select coalesce(max(v.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions v
  where v.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  -- Snapshot all settings-owned staged rows now. Execution will merge this immutable intent with
  -- the then-current catalog core, so later unpublished Admin edits cannot leak into the schedule.
  v_payload := private.build_effective_shop_settings_payload_v1(
    v_business_id, p_shop_id, v_current_settings_version + 1
  );

  return private.schedule_admin_shop_config_v1(
    p_employee_id,
    p_shop_id,
    'PUBLISH_SETTINGS',
    v_payload,
    null,
    p_expected_settings_version,
    p_local_scheduled_at
  );
end;
$$;

create or replace function public.schedule_shop_online_orders_state_v1(
  p_employee_id uuid,
  p_shop_id uuid,
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
  v_payload jsonb;
  v_fallback jsonb;
  v_settings jsonb;
  v_identity jsonb;
begin
  if p_online_orders_paused is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_schedule');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select coalesce(max(v.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions v
  where v.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  v_fallback := private.build_effective_shop_settings_payload_v1(
    v_business_id, p_shop_id, v_current_settings_version + 1
  );
  select v.settings_json into v_payload
  from public.shop_settings_versions v
  where v.shop_id = p_shop_id
  order by v.settings_version desc
  limit 1;
  v_payload := coalesce(v_payload, v_fallback);

  -- Published values win over mutable staging. The fallback only supplies rollout fields that an
  -- older immutable payload did not yet contain.
  v_settings := coalesce(v_fallback -> 'settings', '{}'::jsonb)
    || coalesce(v_payload -> 'settings', '{}'::jsonb);
  v_identity := coalesce(v_fallback #> '{settings,shopIdentity}', '{}'::jsonb)
    || coalesce(v_payload #> '{settings,shopIdentity}', '{}'::jsonb);
  v_identity := jsonb_set(v_identity, '{onlineOrdersPaused}', to_jsonb(p_online_orders_paused), true);
  v_settings := jsonb_set(v_settings, '{version}', to_jsonb(v_current_settings_version + 1), true);
  v_settings := jsonb_set(v_settings, '{shopIdentity}', v_identity, true);
  v_payload := jsonb_build_object(
    'settings', v_settings,
    'orderTypes', coalesce(v_payload -> 'orderTypes', v_fallback -> 'orderTypes', '[]'::jsonb),
    'paymentMethods', coalesce(v_payload -> 'paymentMethods', v_fallback -> 'paymentMethods', '[]'::jsonb),
    'deliveryZones', coalesce(v_payload -> 'deliveryZones', v_fallback -> 'deliveryZones', '[]'::jsonb),
    'reasonCodes', coalesce(v_payload -> 'reasonCodes', v_fallback -> 'reasonCodes', '[]'::jsonb)
  );

  return private.schedule_admin_shop_config_v1(
    p_employee_id,
    p_shop_id,
    'ONLINE_ORDERS_STATE',
    v_payload,
    p_online_orders_paused,
    p_expected_settings_version,
    p_local_scheduled_at
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
  v_base jsonb;
  v_bundle jsonb;
  v_online_orders_paused boolean;
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

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_change.shop_id::text, 0));

  select coalesce(max(v.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions v
  where v.shop_id = v_change.shop_id;
  if v_current_settings_version <> v_target_base_settings_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_settings_version',
      'currentVersion', v_current_settings_version
    );
  end if;

  if (v_payload #>> '{settings,version}')::bigint <> v_current_settings_version + 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_snapshot_version');
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_change.shop_id;
  v_next_settings_version := v_current_settings_version + 1;
  v_next_operations_version := v_current_operations_version + 1;

  v_base := private.build_admin_catalog_core_bundle_v1(
    v_change.shop_id, v_next_operations_version, v_now
  );
  v_bundle := private.merge_admin_settings_bundle_v1(v_base, v_payload);

  if v_operation = 'ONLINE_ORDERS_STATE' then
    v_online_orders_paused := (v_change.payload_json ->> 'onlineOrdersPaused')::boolean;
    if v_online_orders_paused is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_shop_config_payload');
    end if;
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
    settings_json, bundle_json, published_by_employee_id, published_at, scheduled_change_id
  ) values (
    v_change.business_id,
    v_change.shop_id,
    v_next_settings_version,
    v_next_operations_version,
    v_payload,
    v_bundle,
    v_change.created_by_employee_id,
    v_now,
    v_change.id
  );

  return jsonb_build_object(
    'ok', true,
    'settingsVersion', v_next_settings_version,
    'operationsConfigurationVersion', v_next_operations_version
  );
end;
$$;

-- The durable scheduler must claim SHOP_CONFIG rows under the same bounded lease/retry policy.
create or replace function public.claim_due_admin_config_changes_v1(
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  business_id uuid,
  shop_id uuid,
  created_by_employee_id uuid,
  change_kind text,
  payload_json jsonb,
  scheduled_for timestamptz,
  target_base_publish_version bigint,
  idempotency_key text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_now is null then raise exception 'TUX_ADMIN_SCHEDULER_NOW_REQUIRED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'TUX_ADMIN_SCHEDULER_LIMIT_INVALID'; end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'TUX_ADMIN_SCHEDULER_LEASE_INVALID'; end if;

  update public.scheduled_config_changes s
  set status = 'FAILED', claimed_at = null, terminal_failure = true, next_attempt_at = null,
      last_error = coalesce(s.last_error, 'catalog_scheduler_retry_limit_exhausted'), updated_at = p_now
  where s.status = 'CLAIMED' and s.attempt_count >= 5 and s.claimed_at is not null
    and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds);

  return query
  with candidates as (
    select s.id,
      case
        when s.change_kind = 'PRODUCT_AVAILABILITY' and s.payload_json ->> 'transition' = 'EXIT' then 0
        when s.change_kind = 'PRODUCT_AVAILABILITY' and s.payload_json ->> 'transition' = 'ENTER' then 1
        else 0
      end as transition_priority
    from public.scheduled_config_changes s
    where s.change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY', 'SHOP_CONFIG')
      and s.scheduled_for <= p_now
      and s.attempt_count < 5
      and (
        s.status = 'PENDING'
        or (s.status = 'FAILED' and s.terminal_failure = false and s.next_attempt_at is not null and s.next_attempt_at <= p_now)
        or (s.status = 'CLAIMED' and s.claimed_at is not null and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds))
      )
      and (
        s.change_kind <> 'PRODUCT_AVAILABILITY'
        or s.payload_json ->> 'transition' <> 'ENTER'
        or not exists (
          select 1 from public.scheduled_config_changes predecessor
          where predecessor.shop_id = s.shop_id
            and predecessor.change_kind = 'PRODUCT_AVAILABILITY'
            and predecessor.scheduled_for = s.scheduled_for
            and predecessor.payload_json ->> 'transition' = 'EXIT'
            and predecessor.payload_json ->> 'masterProductId' = s.payload_json ->> 'masterProductId'
            and predecessor.status not in ('APPLIED', 'CANCELLED')
        )
      )
    order by case when s.status = 'FAILED' then s.next_attempt_at else s.scheduled_for end,
      s.scheduled_for, transition_priority, s.id
    for update of s skip locked
    limit p_limit
  ), claimed as (
    update public.scheduled_config_changes s
    set status = 'CLAIMED', claimed_at = p_now, next_attempt_at = null,
        terminal_failure = false, attempt_count = s.attempt_count + 1, updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.id, s.business_id, s.shop_id, s.created_by_employee_id, s.change_kind,
      s.payload_json, s.scheduled_for, s.target_base_publish_version, s.idempotency_key, s.attempt_count
  )
  select c.id, c.business_id, c.shop_id, c.created_by_employee_id, c.change_kind,
    c.payload_json, c.scheduled_for, c.target_base_publish_version, c.idempotency_key, c.attempt_count
  from claimed c
  order by c.scheduled_for,
    case
      when c.change_kind = 'PRODUCT_AVAILABILITY' and c.payload_json ->> 'transition' = 'EXIT' then 0
      when c.change_kind = 'PRODUCT_AVAILABILITY' and c.payload_json ->> 'transition' = 'ENTER' then 1
      else 0
    end,
    c.id;
end;
$$;

revoke all on function public.schedule_shop_settings_publish_v1(uuid, uuid, bigint, timestamp without time zone)
  from public, anon, authenticated;
revoke all on function public.schedule_shop_online_orders_state_v1(uuid, uuid, boolean, bigint, timestamp without time zone)
  from public, anon, authenticated;
revoke all on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.schedule_shop_settings_publish_v1(uuid, uuid, bigint, timestamp without time zone) to service_role;
    grant execute on function public.schedule_shop_online_orders_state_v1(uuid, uuid, boolean, bigint, timestamp without time zone) to service_role;
    grant execute on function public.apply_scheduled_shop_config_change_v1(uuid, text, integer) to service_role;
    grant execute on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer) to service_role;
  end if;
end $$;

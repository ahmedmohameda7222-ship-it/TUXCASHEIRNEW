-- TUX Admin Plan 2 final review round 16 hardening.
-- Additive only:
-- 1) make SHOP_CONFIG schedule replay identity include the immutable settings snapshot;
-- 2) make recurring Cairo materialization reject DST gap/repeated wall-clock occurrences as a pair.

-- Round 15 moved the mature SHOP_CONFIG scheduler core behind a strict Cairo wall-clock wrapper.
-- Preserve that wrapper and replace only the core replay identity so a changed immutable snapshot
-- at the same published version and activation time is a distinct accepted intent.
create or replace function private.schedule_admin_shop_config_v1_pre_round15(
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
  v_payload_sha256 text;
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
  v_payload_sha256 := encode(extensions.digest(p_settings_payload::text, 'sha256'), 'hex');
  v_idempotency_key := format(
    'shop-config:%s:%s:%s:%s:%s:%s',
    p_shop_id,
    p_operation,
    p_expected_settings_version,
    coalesce(p_online_orders_paused::text, 'settings'),
    to_char(p_local_scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    v_payload_sha256
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

revoke all on function private.schedule_admin_shop_config_v1_pre_round15(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) from public, anon, authenticated;

-- Recurring rules are wall-clock rules. Round 16 makes DST behavior explicit: if either ENTER or
-- EXIT boundary for an occurrence does not map to exactly one Cairo instant, skip the whole pair.
-- This avoids both silent normalization and stranded one-sided availability state.
create or replace function public.materialize_recurring_availability_changes_v1(
  p_now timestamptz default now(),
  p_horizon_days integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule record;
  v_local_today date;
  v_local_date date;
  v_enter_local timestamp without time zone;
  v_exit_local timestamp without time zone;
  v_enter_resolution jsonb;
  v_exit_resolution jsonb;
  v_enter_scheduled_for timestamptz;
  v_exit_scheduled_for timestamptz;
  v_inserted integer := 0;
  v_skipped_dst integer := 0;
  v_rows integer;
  v_transition text;
  v_local_scheduled_at timestamp without time zone;
  v_scheduled_for timestamptz;
  v_occurrence_date date;
  v_key text;
begin
  if p_now is null or p_horizon_days is null or p_horizon_days < 1 or p_horizon_days > 31 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  v_local_today := (p_now at time zone 'Africa/Cairo')::date;

  for v_rule in
    select
      r.id,
      r.business_id,
      r.shop_id,
      r.master_product_id,
      r.created_by_employee_id,
      r.days_of_week,
      r.start_local,
      r.end_local,
      r.available,
      r.version
    from public.recurring_availability_rules r
    where r.active
    order by r.shop_id, r.master_product_id, r.id
  loop
    for v_local_date in
      select generated_day::date
      from generate_series(
        v_local_today - 1,
        v_local_today + p_horizon_days,
        interval '1 day'
      ) as generated_day
    loop
      if extract(dow from v_local_date)::smallint = any(v_rule.days_of_week) then
        v_enter_local := v_local_date + v_rule.start_local;
        v_exit_local := case
          when v_rule.end_local > v_rule.start_local
            then v_local_date + v_rule.end_local
          else v_local_date + 1 + v_rule.end_local
        end;

        v_enter_resolution := private.resolve_admin_cairo_schedule_v1(v_enter_local);
        v_exit_resolution := private.resolve_admin_cairo_schedule_v1(v_exit_local);

        if coalesce((v_enter_resolution ->> 'ok')::boolean, false) is not true
           or coalesce((v_exit_resolution ->> 'ok')::boolean, false) is not true then
          v_skipped_dst := v_skipped_dst + 1;
          continue;
        end if;

        v_enter_scheduled_for := (v_enter_resolution ->> 'scheduledFor')::timestamptz;
        v_exit_scheduled_for := (v_exit_resolution ->> 'scheduledFor')::timestamptz;
        v_occurrence_date := v_local_date;

        foreach v_transition in array array['ENTER', 'EXIT']::text[]
        loop
          if v_transition = 'ENTER' then
            v_local_scheduled_at := v_enter_local;
            v_scheduled_for := v_enter_scheduled_for;
          else
            v_local_scheduled_at := v_exit_local;
            v_scheduled_for := v_exit_scheduled_for;
          end if;

          v_key := format(
            'recurring:%s:v%s:%s:%s',
            v_rule.id,
            v_rule.version,
            to_char(v_occurrence_date, 'YYYY-MM-DD'),
            lower(v_transition)
          );

          insert into public.scheduled_config_changes(
            business_id,
            shop_id,
            created_by_employee_id,
            change_kind,
            payload_json,
            timezone,
            local_scheduled_at,
            scheduled_for,
            target_base_publish_version,
            idempotency_key,
            status
          ) values (
            v_rule.business_id,
            v_rule.shop_id,
            v_rule.created_by_employee_id,
            'PRODUCT_AVAILABILITY',
            jsonb_build_object(
              'ruleId', v_rule.id,
              'ruleVersion', v_rule.version,
              'transition', v_transition,
              'masterProductId', v_rule.master_product_id
            ),
            'Africa/Cairo',
            v_local_scheduled_at,
            v_scheduled_for,
            null,
            v_key,
            'PENDING'
          )
          on conflict (shop_id, idempotency_key) do nothing;

          get diagnostics v_rows = row_count;
          v_inserted := v_inserted + v_rows;
        end loop;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'materialized', v_inserted,
    'skippedDstOccurrences', v_skipped_dst,
    'skipPolicy', 'recurring_dst_occurrence_skipped'
  );
end;
$$;

revoke all on function public.materialize_recurring_availability_changes_v1(timestamptz, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.materialize_recurring_availability_changes_v1(timestamptz, integer)
      to service_role;
  end if;
end $$;

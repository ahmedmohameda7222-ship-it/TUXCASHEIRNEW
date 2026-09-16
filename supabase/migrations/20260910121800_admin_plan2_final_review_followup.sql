-- TUX Admin Plan 2 final review follow-up hardening.
-- Additive only: emergency settings publication isolation, recurring transition dependency fencing,
-- and single-live-schedule replacement for a catalog draft revision.

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

  select s.lifecycle_state
    into v_lifecycle_state
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

  -- Emergency state must never rebuild from mutable Admin settings tables. Start from the latest
  -- immutable Operations bundle and patch only the version/timestamp and the two explicit flags.
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

  v_previous_shop_identity := coalesce(v_previous_settings -> 'shopIdentity', '{}'::jsonb);
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
  v_previous_settings := jsonb_set(v_previous_settings, '{version}', to_jsonb(v_next_settings_version), true);
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
  if p_now is null then
    raise exception 'TUX_ADMIN_SCHEDULER_NOW_REQUIRED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'TUX_ADMIN_SCHEDULER_LIMIT_INVALID';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'TUX_ADMIN_SCHEDULER_LEASE_INVALID';
  end if;

  update public.scheduled_config_changes s
  set status = 'FAILED',
      claimed_at = null,
      terminal_failure = true,
      next_attempt_at = null,
      last_error = coalesce(s.last_error, 'catalog_scheduler_retry_limit_exhausted'),
      updated_at = p_now
  where s.status = 'CLAIMED'
    and s.attempt_count >= 5
    and s.claimed_at is not null
    and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds);

  return query
  with candidates as (
    select
      s.id,
      case
        when s.change_kind = 'PRODUCT_AVAILABILITY'
          and s.payload_json ->> 'transition' = 'EXIT' then 0
        when s.change_kind = 'PRODUCT_AVAILABILITY'
          and s.payload_json ->> 'transition' = 'ENTER' then 1
        else 0
      end as transition_priority
    from public.scheduled_config_changes s
    where s.change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY')
      and s.scheduled_for <= p_now
      and s.attempt_count < 5
      and (
        s.status = 'PENDING'
        or (
          s.status = 'FAILED'
          and s.terminal_failure = false
          and s.next_attempt_at is not null
          and s.next_attempt_at <= p_now
        )
        or (
          s.status = 'CLAIMED'
          and s.claimed_at is not null
          and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds)
        )
      )
      and (
        s.change_kind <> 'PRODUCT_AVAILABILITY'
        or s.payload_json ->> 'transition' <> 'ENTER'
        or not exists (
          select 1
          from public.scheduled_config_changes predecessor
          where predecessor.shop_id = s.shop_id
            and predecessor.change_kind = 'PRODUCT_AVAILABILITY'
            and predecessor.scheduled_for = s.scheduled_for
            and predecessor.payload_json ->> 'transition' = 'EXIT'
            and predecessor.payload_json ->> 'masterProductId' = s.payload_json ->> 'masterProductId'
            and predecessor.status not in ('APPLIED', 'CANCELLED')
        )
      )
    order by
      case when s.status = 'FAILED' then s.next_attempt_at else s.scheduled_for end,
      s.scheduled_for,
      transition_priority,
      s.id
    for update of s skip locked
    limit p_limit
  ), claimed as (
    update public.scheduled_config_changes s
    set status = 'CLAIMED',
        claimed_at = p_now,
        next_attempt_at = null,
        terminal_failure = false,
        attempt_count = s.attempt_count + 1,
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning
      s.id,
      s.business_id,
      s.shop_id,
      s.created_by_employee_id,
      s.change_kind,
      s.payload_json,
      s.scheduled_for,
      s.target_base_publish_version,
      s.idempotency_key,
      s.attempt_count
  )
  select
    c.id,
    c.business_id,
    c.shop_id,
    c.created_by_employee_id,
    c.change_kind,
    c.payload_json,
    c.scheduled_for,
    c.target_base_publish_version,
    c.idempotency_key,
    c.attempt_count
  from claimed c
  order by
    c.scheduled_for,
    case
      when c.change_kind = 'PRODUCT_AVAILABILITY'
        and c.payload_json ->> 'transition' = 'EXIT' then 0
      when c.change_kind = 'PRODUCT_AVAILABILITY'
        and c.payload_json ->> 'transition' = 'ENTER' then 1
      else 0
    end,
    c.id;
end;
$$;

revoke all on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
      to service_role;
  end if;
end $$;

create or replace function public.schedule_catalog_draft_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint,
  p_local_scheduled_at timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_business_id uuid;
  v_current_publish_version bigint;
  v_pricing_changed boolean;
  v_scheduled_for timestamptz;
  v_idempotency_key text;
  v_schedule_id uuid;
  v_existing_status text;
  v_existing_live_id uuid;
  v_existing_live_status text;
  v_existing_live_idempotency_key text;
begin
  if p_local_scheduled_at is null then
    return jsonb_build_object('ok', false, 'code', 'scheduled_time_required');
  end if;

  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_schedulable');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, v_draft.shop_id, 'catalog.publish'
  );
  if v_business_id <> v_draft.business_id then
    raise exception 'TUX_ADMIN_CATALOG_BUSINESS_MISMATCH';
  end if;

  if p_expected_draft_revision <> v_draft.draft_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_draft_revision',
      'currentDraftRevision', v_draft.draft_revision
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_draft.shop_id::text, 0));

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = v_draft.shop_id;

  if p_expected_base_publish_version <> v_current_publish_version
     or v_draft.base_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  perform private.validate_admin_catalog_bundle_v1(
    v_draft.shop_id,
    v_draft.working_bundle_json
  );

  select exists (
    select 1
    from jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'products') as next_product(
      id uuid, "priceMinor" bigint
    )
    left join public.products p
      on p.id = next_product.id and p.shop_id = v_draft.shop_id
    where p.id is null or p.price_minor is distinct from next_product."priceMinor"
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  if p_local_scheduled_at <= (now() at time zone 'Africa/Cairo') then
    return jsonb_build_object('ok', false, 'code', 'scheduled_time_must_be_future');
  end if;

  v_scheduled_for := p_local_scheduled_at at time zone 'Africa/Cairo';
  v_idempotency_key := format(
    'catalog-publish:%s:%s:%s:%s',
    v_draft.id,
    v_draft.draft_revision,
    v_current_publish_version,
    to_char(p_local_scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')
  );

  -- The draft row and shop advisory locks serialize reschedules. Prefer any CLAIMED schedule so a
  -- worker-owned execution fails closed; otherwise select an exact replay before replacing older work.
  select s.id, s.status, s.idempotency_key
    into v_existing_live_id, v_existing_live_status, v_existing_live_idempotency_key
  from public.scheduled_config_changes s
  where s.shop_id = v_draft.shop_id
    and s.change_kind = 'CATALOG_PUBLISH'
    and s.payload_json ->> 'draftId' = v_draft.id::text
    and (s.payload_json ->> 'expectedDraftRevision')::bigint = v_draft.draft_revision
    and s.status in ('PENDING', 'FAILED', 'CLAIMED')
  order by
    case
      when s.status = 'CLAIMED' and s.idempotency_key <> v_idempotency_key then 0
      when s.status = 'CLAIMED' then 1
      when s.idempotency_key = v_idempotency_key then 2
      else 3
    end,
    s.created_at desc,
    s.id
  limit 1
  for update;

  if v_existing_live_id is not null then
    if v_existing_live_status = 'CLAIMED' then
      if v_existing_live_idempotency_key = v_idempotency_key then
        return jsonb_build_object(
          'ok', true,
          'scheduleId', v_existing_live_id,
          'status', v_existing_live_status,
          'scheduledFor', v_scheduled_for,
          'localScheduledAt', p_local_scheduled_at,
          'timezone', 'Africa/Cairo',
          'idempotentReplay', true
        );
      end if;

      return jsonb_build_object(
        'ok', false,
        'code', 'schedule_claimed',
        'scheduleId', v_existing_live_id
      );
    end if;

    if v_existing_live_idempotency_key = v_idempotency_key then
      -- Clean up any historical duplicate non-claimed schedules without disturbing this replay.
      update public.scheduled_config_changes s
      set status = 'CANCELLED',
          claimed_at = null,
          next_attempt_at = null,
          terminal_failure = false,
          last_error = 'replaced_by_idempotent_schedule_reconciliation',
          updated_at = now()
      where s.shop_id = v_draft.shop_id
        and s.change_kind = 'CATALOG_PUBLISH'
        and s.payload_json ->> 'draftId' = v_draft.id::text
        and (s.payload_json ->> 'expectedDraftRevision')::bigint = v_draft.draft_revision
        and s.status in ('PENDING', 'FAILED')
        and s.id <> v_existing_live_id;

      return jsonb_build_object(
        'ok', true,
        'scheduleId', v_existing_live_id,
        'status', v_existing_live_status,
        'scheduledFor', v_scheduled_for,
        'localScheduledAt', p_local_scheduled_at,
        'timezone', 'Africa/Cairo',
        'idempotentReplay', true
      );
    end if;

    update public.scheduled_config_changes s
    set status = 'CANCELLED',
        claimed_at = null,
        next_attempt_at = null,
        terminal_failure = false,
        last_error = 'replaced_by_reschedule',
        updated_at = now()
    where s.shop_id = v_draft.shop_id
      and s.change_kind = 'CATALOG_PUBLISH'
      and s.payload_json ->> 'draftId' = v_draft.id::text
      and (s.payload_json ->> 'expectedDraftRevision')::bigint = v_draft.draft_revision
      and s.status in ('PENDING', 'FAILED');
  end if;

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
    v_business_id,
    v_draft.shop_id,
    p_employee_id,
    'CATALOG_PUBLISH',
    jsonb_build_object(
      'draftId', v_draft.id,
      'expectedDraftRevision', v_draft.draft_revision
    ),
    'Africa/Cairo',
    p_local_scheduled_at,
    v_scheduled_for,
    v_current_publish_version,
    v_idempotency_key,
    'PENDING'
  )
  on conflict (shop_id, idempotency_key) do nothing
  returning id into v_schedule_id;

  if v_schedule_id is null then
    select s.id, s.status
      into v_schedule_id, v_existing_status
    from public.scheduled_config_changes s
    where s.shop_id = v_draft.shop_id
      and s.idempotency_key = v_idempotency_key;

    if v_schedule_id is null then
      raise exception 'TUX_ADMIN_CATALOG_SCHEDULE_CONFLICT';
    end if;

    return jsonb_build_object(
      'ok', true,
      'scheduleId', v_schedule_id,
      'status', v_existing_status,
      'scheduledFor', v_scheduled_for,
      'localScheduledAt', p_local_scheduled_at,
      'timezone', 'Africa/Cairo',
      'idempotentReplay', true
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'scheduleId', v_schedule_id,
    'status', 'PENDING',
    'scheduledFor', v_scheduled_for,
    'localScheduledAt', p_local_scheduled_at,
    'timezone', 'Africa/Cairo',
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.schedule_catalog_draft_v1(uuid, uuid, bigint, bigint, timestamp without time zone)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.schedule_catalog_draft_v1(
      uuid, uuid, bigint, bigint, timestamp without time zone
    ) to service_role;
  end if;
end $$;

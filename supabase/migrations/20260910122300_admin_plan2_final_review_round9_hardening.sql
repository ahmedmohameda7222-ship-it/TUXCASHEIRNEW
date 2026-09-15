-- TUX Admin Plan 2 final review round 9 hardening.
-- Additive only: preserve scheduled publication across an ordinary transient draft rebase,
-- and align schedule-time pricing authority with publish-time product/modifier pricing checks.

create or replace function public.publish_catalog_draft_scheduled_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_version public.catalog_publish_versions%rowtype;
  v_current_publish_version bigint;
  v_rebase jsonb;
  v_result jsonb;
begin
  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;

  if p_expected_draft_revision <> v_draft.draft_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_draft_revision',
      'currentDraftRevision', v_draft.draft_revision
    );
  end if;

  if v_draft.status = 'PUBLISHED' then
    select * into v_version
    from public.catalog_publish_versions published
    where published.shop_id = v_draft.shop_id
      and published.draft_id = v_draft.id
      and published.publish_version = v_draft.published_version
      and published.source_kind = 'DRAFT';

    if not found then
      return jsonb_build_object('ok', false, 'code', 'published_version_missing');
    end if;

    return jsonb_build_object(
      'ok', true,
      'draftId', v_draft.id,
      'publishVersion', v_version.publish_version,
      'operationsConfigurationVersion', v_version.operations_configuration_version,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_draft.shop_id::text, 0));

  -- A persisted resume may already have advanced the draft base over transient availability
  -- publications. Keep the schedule's original fence valid only when the entire lineage from that
  -- fence to the draft's current base is transient authority; any content publication remains stale.
  if p_expected_base_publish_version > v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_draft.base_publish_version
    );
  end if;

  if p_expected_base_publish_version < v_draft.base_publish_version
     and exists (
       select 1
       from public.catalog_publish_versions published
       where published.shop_id = v_draft.shop_id
         and published.publish_version > p_expected_base_publish_version
         and published.publish_version <= v_draft.base_publish_version
         and published.source_kind not in ('RECURRING_AVAILABILITY', 'IMMEDIATE_AVAILABILITY')
     ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_draft.base_publish_version
    );
  end if;

  select coalesce(max(published.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions published
  where published.shop_id = v_draft.shop_id;

  if v_current_publish_version < v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  if v_current_publish_version > v_draft.base_publish_version then
    v_rebase := private.rebase_admin_catalog_draft_transient_v1(
      v_draft.id,
      v_current_publish_version
    );
    if coalesce((v_rebase ->> 'ok')::boolean, false) is not true then
      return v_rebase;
    end if;

    select * into v_draft
    from public.catalog_drafts d
    where d.id = p_draft_id
    for update;
  end if;

  v_result := public.publish_catalog_draft_v1(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    v_draft.base_publish_version
  );
  return v_result;
end;
$$;

revoke all on function public.publish_catalog_draft_scheduled_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;

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

  select (
    exists (
      select 1
      from jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'products') as next_product(
        id uuid, "priceMinor" bigint
      )
      left join public.products p
        on p.id = next_product.id and p.shop_id = v_draft.shop_id
      where p.id is null or p.price_minor is distinct from next_product."priceMinor"
    )
    or exists (
      select 1
      from jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'modifiers') as next_modifier(
        id uuid, "priceMinor" bigint
      )
      left join public.modifiers m
        on m.id = next_modifier.id and m.shop_id = v_draft.shop_id
      where m.id is null or m.price_minor is distinct from next_modifier."priceMinor"
    )
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

  -- Preserve the current one-live-schedule semantics: a worker-owned CLAIMED row fences
  -- rescheduling; otherwise exact replay wins before older retryable rows are replaced.
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
    grant execute on function public.publish_catalog_draft_scheduled_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.schedule_catalog_draft_v1(
      uuid, uuid, bigint, bigint, timestamp without time zone
    ) to service_role;
  end if;
end $$;

-- TUX Admin Plan 2 publish history, rollback-as-new-version, and one-time scheduling controls.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Historical publish rows are immutable; restore appends a new canonical publish version.

alter table public.catalog_publish_versions
  add column if not exists restored_from_publish_version bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_publish_versions_restore_lineage_fk'
      and conrelid = 'public.catalog_publish_versions'::regclass
  ) then
    alter table public.catalog_publish_versions
      add constraint catalog_publish_versions_restore_lineage_fk
      foreign key (shop_id, restored_from_publish_version)
      references public.catalog_publish_versions(shop_id, publish_version)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_publish_versions_restore_lineage_ck'
      and conrelid = 'public.catalog_publish_versions'::regclass
  ) then
    alter table public.catalog_publish_versions
      add constraint catalog_publish_versions_restore_lineage_ck
      check (
        (source_kind = 'ROLLBACK' and restored_from_publish_version is not null)
        or (source_kind <> 'ROLLBACK' and restored_from_publish_version is null)
      );
  end if;
end $$;

create or replace function public.restore_catalog_publish_version_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_source_publish_version bigint,
  p_expected_current_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_source public.catalog_publish_versions%rowtype;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_pricing_changed boolean;
begin
  if p_source_publish_version is null or p_source_publish_version < 1
     or p_expected_current_publish_version is null or p_expected_current_publish_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.publish'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  if p_expected_current_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  select * into v_source
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id
    and v.publish_version = p_source_publish_version;

  if not found or v_source.business_id <> v_business_id then
    return jsonb_build_object('ok', false, 'code', 'publish_version_not_found');
  end if;

  if p_source_publish_version >= v_current_publish_version then
    return jsonb_build_object('ok', false, 'code', 'restore_source_must_be_historical');
  end if;

  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_source.bundle_json);

  select exists (
    select 1
    from jsonb_to_recordset(v_source.bundle_json -> 'snapshot' -> 'products') as source_product(
      id uuid, "priceMinor" bigint
    )
    left join public.products p
      on p.id = source_product.id and p.shop_id = p_shop_id
    where p.id is null or p.price_minor is distinct from source_product."priceMinor"
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, p_shop_id, 'catalog.pricing'
    );
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id,
    v_new_operations_version,
    now(),
    v_source.bundle_json
  );

  perform public.publish_tux_operations_configuration(
    p_shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);
  perform private.sync_admin_master_catalog_v1(v_business_id, p_shop_id);

  insert into public.catalog_publish_versions(
    business_id,
    shop_id,
    publish_version,
    operations_configuration_version,
    source_kind,
    published_by_employee_id,
    restored_from_publish_version,
    bundle_json,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_new_publish_version,
    v_new_operations_version,
    'ROLLBACK',
    p_employee_id,
    p_source_publish_version,
    v_bundle,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'sourcePublishVersion', p_source_publish_version,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

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

create or replace function public.cancel_scheduled_config_change_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_schedule_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_schedule public.scheduled_config_changes%rowtype;
begin
  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.publish'
  );

  select * into v_schedule
  from public.scheduled_config_changes s
  where s.id = p_schedule_id
    and s.shop_id = p_shop_id
  for update;

  if not found or v_schedule.business_id <> v_business_id then
    return jsonb_build_object('ok', false, 'code', 'schedule_not_found');
  end if;

  if v_schedule.change_kind <> 'CATALOG_PUBLISH' then
    return jsonb_build_object('ok', false, 'code', 'unsupported_schedule_kind');
  end if;

  if v_schedule.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', true,
      'scheduleId', v_schedule.id,
      'status', 'CANCELLED',
      'idempotentReplay', true
    );
  end if;
  if v_schedule.status = 'CLAIMED' then
    return jsonb_build_object('ok', false, 'code', 'schedule_in_progress');
  end if;
  if v_schedule.status = 'APPLIED' then
    return jsonb_build_object('ok', false, 'code', 'schedule_already_applied');
  end if;

  update public.scheduled_config_changes
  set status = 'CANCELLED',
      claimed_at = null,
      last_error = null,
      updated_at = now()
  where id = v_schedule.id
    and status in ('PENDING', 'FAILED');

  return jsonb_build_object(
    'ok', true,
    'scheduleId', v_schedule.id,
    'status', 'CANCELLED',
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.restore_catalog_publish_version_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.schedule_catalog_draft_v1(uuid, uuid, bigint, bigint, timestamp without time zone)
  from public, anon, authenticated;
revoke all on function public.cancel_scheduled_config_change_v1(uuid, uuid, uuid)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.restore_catalog_publish_version_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.schedule_catalog_draft_v1(uuid, uuid, bigint, bigint, timestamp without time zone)
      to service_role;
    grant execute on function public.cancel_scheduled_config_change_v1(uuid, uuid, uuid)
      to service_role;
  end if;
end $$;

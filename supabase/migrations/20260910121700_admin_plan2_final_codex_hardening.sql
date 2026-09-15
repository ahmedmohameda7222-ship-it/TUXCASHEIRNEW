-- TUX Admin Plan 2 final Codex-review hardening.
-- Additive only: scheduled-draft recurrence rebasing, deterministic recurring transition claims,
-- and immediate trusted shop operational-state controls.

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
  v_rebased_products jsonb;
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

  -- A worker may retry after the first scheduled execution rebased the draft and published it.
  -- Reconcile that already-published result before comparing the caller's original base version.
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

  -- The schedule still fences the draft version it originally targeted. Only after that fence
  -- succeeds may we transparently advance across recurrence-owned transient availability versions.
  if p_expected_base_publish_version <> v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_draft.base_publish_version
    );
  end if;

  -- Serialize with all catalog publishers/recurring availability transitions.
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_draft.shop_id::text, 0));

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
    if exists (
      select 1
      from public.catalog_publish_versions published
      where published.shop_id = v_draft.shop_id
        and published.publish_version > v_draft.base_publish_version
        and published.publish_version <= v_current_publish_version
        and published.source_kind <> 'RECURRING_AVAILABILITY'
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_version',
        'currentVersion', v_current_publish_version
      );
    end if;

    -- soldOut is live/transient authority, not draft-owned catalog content. Preserve the latest
    -- canonical value for products that already exist while leaving draft-created products intact.
    select coalesce(
      jsonb_agg(
        case
          when canonical.id is null then candidate.product
          else jsonb_set(candidate.product, '{soldOut}', to_jsonb(canonical.sold_out), false)
        end
        order by candidate.ordinality
      ),
      '[]'::jsonb
    )
      into v_rebased_products
    from jsonb_array_elements(v_draft.working_bundle_json #> '{snapshot,products}')
      with ordinality as candidate(product, ordinality)
    left join public.products canonical
      on canonical.shop_id = v_draft.shop_id
     and canonical.id = (candidate.product ->> 'id')::uuid;

    update public.catalog_drafts
    set working_bundle_json = jsonb_set(
          v_draft.working_bundle_json,
          '{snapshot,products}',
          v_rebased_products,
          false
        ),
        base_publish_version = v_current_publish_version,
        updated_at = now()
    where id = v_draft.id;

    v_draft.base_publish_version := v_current_publish_version;
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

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.publish_catalog_draft_scheduled_v1(uuid, uuid, bigint, bigint)
      to service_role;
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
  v_lifecycle_state text;
  v_publish_result jsonb;
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

  update public.shops
  set temporary_closed = p_temporary_closed,
      online_orders_paused = p_online_orders_paused,
      updated_at = now()
  where id = p_shop_id;

  v_publish_result := public.publish_shop_settings_v1(
    p_employee_id,
    p_shop_id,
    p_expected_settings_version
  );

  if coalesce((v_publish_result ->> 'ok')::boolean, false) is not true then
    raise exception 'TUX_ADMIN_OPERATIONAL_STATE_PUBLISH_FAILED:%', v_publish_result::text;
  end if;

  return v_publish_result;
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

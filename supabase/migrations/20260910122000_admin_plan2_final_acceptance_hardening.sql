-- TUX Admin Plan 2 final acceptance hardening.
-- Additive only: transient-availability scheduled-draft rebasing, durable recurring dependencies,
-- scheduler-authority recurring execution, persisted draft resume, and trusted Shop/Hours management.

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

  if p_expected_base_publish_version <> v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_draft.base_publish_version
    );
  end if;

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
        and published.source_kind not in ('RECURRING_AVAILABILITY', 'IMMEDIATE_AVAILABILITY')
    ) then
      return jsonb_build_object(
        'ok', false,
        'code', 'stale_version',
        'currentVersion', v_current_publish_version
      );
    end if;

    -- Availability publications are transient authority. Keep the draft's catalog edits while
    -- rebasing soldOut from the current canonical row so a scheduled draft cannot resurrect stale
    -- availability state.
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
      and (
        s.change_kind <> 'PRODUCT_AVAILABILITY'
        or s.payload_json ->> 'transition' <> 'ENTER'
        or not exists (
          select 1
          from public.scheduled_config_changes predecessor
          where predecessor.shop_id = s.shop_id
            and predecessor.change_kind = 'PRODUCT_AVAILABILITY'
            and predecessor.scheduled_for <= s.scheduled_for
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

create or replace function public.apply_recurring_product_availability_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_rule_id uuid,
  p_rule_version bigint,
  p_transition text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule public.recurring_availability_rules%rowtype;
  v_business_id uuid;
  v_product_id uuid;
  v_manual_sold_out boolean;
  v_current_sold_out boolean;
  v_target_sold_out boolean;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_transition not in ('ENTER', 'EXIT') or p_rule_version is null or p_rule_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_rule
  from public.recurring_availability_rules r
  where r.id = p_rule_id
  for update;

  if not found or v_rule.shop_id <> p_shop_id then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  -- Creation/update/enable is authorized at the human command boundary. Materialized occurrences
  -- execute later under service-role scheduler authority; creator identity is audit attribution only.
  v_business_id := v_rule.business_id;

  if not v_rule.active or v_rule.version <> p_rule_version then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select o.canonical_product_id, o.manual_sold_out
    into v_product_id, v_manual_sold_out
  from public.catalog_product_shop_overrides o
  where o.business_id = v_business_id
    and o.shop_id = p_shop_id
    and o.master_product_id = v_rule.master_product_id
  for update;

  if v_product_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_mapping_missing');
  end if;

  select p.sold_out into v_current_sold_out
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_target_sold_out := case
    when p_transition = 'ENTER' then not v_rule.available
    else v_manual_sold_out
  end;

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;
  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  if v_current_sold_out = v_target_sold_out then
    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'productId', v_product_id,
      'soldOut', v_target_sold_out,
      'publishVersion', v_current_publish_version,
      'operationsConfigurationVersion', v_current_operations_version
    );
  end if;

  v_bundle := private.build_admin_catalog_bundle_v1(
    p_shop_id, v_current_operations_version, now()
  );

  select jsonb_agg(
    case
      when product ->> 'id' = v_product_id::text
        then jsonb_set(product, '{soldOut}', to_jsonb(v_target_sold_out), true)
      else product
    end
    order by ordinal
  )
  into v_products
  from jsonb_array_elements(v_bundle -> 'snapshot' -> 'products')
    with ordinality as source(product, ordinal);

  if v_products is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_bundle := jsonb_set(v_bundle, '{snapshot,products}', v_products, false);
  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_bundle);

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );

  perform private.publish_admin_catalog_configuration_v1(
    p_shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);

  update public.products
  set sold_out_updated_at = now(),
      sold_out_by_worker_id = null
  where id = v_product_id and shop_id = p_shop_id;

  insert into public.catalog_publish_versions(
    business_id,
    shop_id,
    publish_version,
    operations_configuration_version,
    source_kind,
    published_by_employee_id,
    bundle_json,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_new_publish_version,
    v_new_operations_version,
    'RECURRING_AVAILABILITY',
    p_employee_id,
    v_bundle,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'productId', v_product_id,
    'soldOut', v_target_sold_out,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

revoke all on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
      to service_role;
  end if;
end $$;

-- Persisted draft resume is a trusted read of an editable draft bundle. The caller still needs
-- catalog.edit and the draft must be based on the exact current publish version.
create or replace function public.resume_catalog_draft_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_draft_id uuid,
  p_expected_current_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_draft public.catalog_drafts%rowtype;
  v_current_publish_version bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_draft_id is null
     or p_expected_current_publish_version is null or p_expected_current_publish_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );

  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
    and d.shop_id = p_shop_id
  for update;

  if not found or v_draft.business_id <> v_business_id then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_editable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  if v_current_publish_version <> p_expected_current_publish_version
     or v_draft.base_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'draftRevision', v_draft.draft_revision,
    'basePublishVersion', v_draft.base_publish_version,
    'bundleJson', v_draft.working_bundle_json
  );
end;
$$;

revoke all on function public.resume_catalog_draft_v1(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.resume_catalog_draft_v1(uuid, uuid, uuid, bigint)
      to service_role;
  end if;
end $$;

-- Shop identity and Hours are canonical mutable Settings inputs. They are not live until the
-- existing publish_shop_settings_v1 boundary creates the next immutable settings snapshot, so
-- effective changes retain the existing publication audit trail.
create or replace function public.update_admin_shop_identity_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_name text,
  p_address_text text,
  p_contact_phone text,
  p_latitude numeric,
  p_longitude numeric,
  p_expected_settings_version bigint,
  p_expected_name text,
  p_expected_address_text text,
  p_expected_contact_phone text,
  p_expected_latitude numeric,
  p_expected_longitude numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_shop public.shops%rowtype;
  v_current_settings_version bigint;
begin
  if p_employee_id is null or p_shop_id is null
     or nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 160
     or (p_address_text is not null and length(btrim(p_address_text)) > 500)
     or (p_contact_phone is not null and length(btrim(p_contact_phone)) > 80)
     or (p_latitude is null) <> (p_longitude is null)
     or (p_latitude is not null and (p_latitude < -90 or p_latitude > 90))
     or (p_longitude is not null and (p_longitude < -180 or p_longitude > 180))
     or p_expected_settings_version is null or p_expected_settings_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_shop_identity');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(
    p_employee_id, p_shop_id, 'settings.manage'
  );
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select * into v_shop from public.shops s where s.id = p_shop_id for update;
  if not found or v_shop.lifecycle_state = 'ARCHIVED' then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;
  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0)
    into v_current_settings_version
  from public.shop_settings_versions s
  where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  if v_shop.name is distinct from p_expected_name
     or v_shop.address_text is distinct from p_expected_address_text
     or v_shop.contact_phone is distinct from p_expected_contact_phone
     or v_shop.latitude is distinct from p_expected_latitude
     or v_shop.longitude is distinct from p_expected_longitude then
    return jsonb_build_object('ok', false, 'code', 'stale_identity');
  end if;

  update public.shops
  set name = btrim(p_name),
      address_text = nullif(btrim(coalesce(p_address_text, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      latitude = p_latitude,
      longitude = p_longitude,
      updated_at = now()
  where id = p_shop_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.upsert_admin_shop_weekly_hours_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_hours_id uuid,
  p_service_kind text,
  p_day_of_week smallint,
  p_opens_local time without time zone,
  p_closes_local time without time zone,
  p_active boolean,
  p_expected_settings_version bigint,
  p_expected_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_existing public.shop_weekly_hours%rowtype;
  v_hours_id uuid;
  v_expected jsonb;
begin
  if p_employee_id is null or p_shop_id is null
     or p_service_kind not in ('OPEN', 'DELIVERY', 'ONLINE')
     or p_day_of_week is null or p_day_of_week < 0 or p_day_of_week > 6
     or p_opens_local is null or p_closes_local is null or p_opens_local = p_closes_local
     or p_active is null or p_expected_settings_version is null or p_expected_settings_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_weekly_hours');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(p_employee_id, p_shop_id, 'settings.manage');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  select coalesce(max(s.settings_version), 0) into v_current_settings_version
  from public.shop_settings_versions s where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  if p_hours_id is null then
    if p_expected_row is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_weekly_hours');
    end if;
    insert into public.shop_weekly_hours(
      business_id, shop_id, service_kind, day_of_week, timezone, opens_local, closes_local, active
    ) values (
      v_business_id, p_shop_id, p_service_kind, p_day_of_week, 'Africa/Cairo', p_opens_local, p_closes_local, p_active
    )
    returning id into v_hours_id;
  else
    select * into v_existing from public.shop_weekly_hours h
    where h.id = p_hours_id and h.shop_id = p_shop_id for update;
    if not found or v_existing.business_id <> v_business_id then
      return jsonb_build_object('ok', false, 'code', 'weekly_hours_not_found');
    end if;
    v_expected := jsonb_build_object(
      'serviceKind', v_existing.service_kind,
      'dayOfWeek', v_existing.day_of_week,
      'opensLocal', v_existing.opens_local::text,
      'closesLocal', v_existing.closes_local::text,
      'active', v_existing.active
    );
    if p_expected_row is null or v_expected <> p_expected_row then
      return jsonb_build_object('ok', false, 'code', 'stale_hours_row');
    end if;
    update public.shop_weekly_hours
    set service_kind = p_service_kind,
        day_of_week = p_day_of_week,
        opens_local = p_opens_local,
        closes_local = p_closes_local,
        active = p_active,
        updated_at = now()
    where id = p_hours_id;
    v_hours_id := p_hours_id;
  end if;

  return jsonb_build_object('ok', true, 'hoursId', v_hours_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'weekly_hours_conflict');
end;
$$;

create or replace function public.upsert_admin_shop_special_hours_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_hours_id uuid,
  p_service_date date,
  p_service_kind text,
  p_closed boolean,
  p_opens_local time without time zone,
  p_closes_local time without time zone,
  p_note text,
  p_active boolean,
  p_expected_settings_version bigint,
  p_expected_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_existing public.shop_special_hours%rowtype;
  v_hours_id uuid;
  v_expected jsonb;
begin
  if p_employee_id is null or p_shop_id is null or p_service_date is null
     or p_service_kind not in ('OPEN', 'DELIVERY', 'ONLINE') or p_closed is null or p_active is null
     or p_expected_settings_version is null or p_expected_settings_version < 0
     or (p_note is not null and length(p_note) > 500)
     or (p_active and p_closed and (p_opens_local is not null or p_closes_local is not null))
     or (p_active and not p_closed and (p_opens_local is null or p_closes_local is null or p_opens_local = p_closes_local)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_special_hours');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(p_employee_id, p_shop_id, 'settings.manage');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  select coalesce(max(s.settings_version), 0) into v_current_settings_version
  from public.shop_settings_versions s where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  if p_hours_id is null then
    if not p_active or p_expected_row is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_special_hours');
    end if;
    insert into public.shop_special_hours(
      business_id, shop_id, service_date, service_kind, timezone, closed, opens_local, closes_local, note
    ) values (
      v_business_id, p_shop_id, p_service_date, p_service_kind, 'Africa/Cairo', p_closed,
      p_opens_local, p_closes_local, nullif(btrim(coalesce(p_note, '')), '')
    ) returning id into v_hours_id;
  else
    select * into v_existing from public.shop_special_hours h
    where h.id = p_hours_id and h.shop_id = p_shop_id for update;
    if not found or v_existing.business_id <> v_business_id then
      return jsonb_build_object('ok', false, 'code', 'special_hours_not_found');
    end if;
    v_expected := jsonb_build_object(
      'serviceDate', v_existing.service_date::text,
      'serviceKind', v_existing.service_kind,
      'closed', v_existing.closed,
      'opensLocal', case when v_existing.opens_local is null then null else to_jsonb(v_existing.opens_local::text) end,
      'closesLocal', case when v_existing.closes_local is null then null else to_jsonb(v_existing.closes_local::text) end,
      'note', to_jsonb(v_existing.note)
    );
    if p_expected_row is null or v_expected <> p_expected_row then
      return jsonb_build_object('ok', false, 'code', 'stale_hours_row');
    end if;

    if not p_active then
      delete from public.shop_special_hours where id = p_hours_id;
      return jsonb_build_object('ok', true, 'hoursId', p_hours_id, 'deactivated', true);
    end if;

    update public.shop_special_hours
    set service_date = p_service_date,
        service_kind = p_service_kind,
        closed = p_closed,
        opens_local = p_opens_local,
        closes_local = p_closes_local,
        note = nullif(btrim(coalesce(p_note, '')), ''),
        updated_at = now()
    where id = p_hours_id;
    v_hours_id := p_hours_id;
  end if;

  return jsonb_build_object('ok', true, 'hoursId', v_hours_id);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'special_hours_conflict');
end;
$$;

revoke all on function public.update_admin_shop_identity_v1(
  uuid, uuid, text, text, text, numeric, numeric, bigint, text, text, text, numeric, numeric
) from public, anon, authenticated;
revoke all on function public.upsert_admin_shop_weekly_hours_v1(
  uuid, uuid, uuid, text, smallint, time without time zone, time without time zone, boolean, bigint, jsonb
) from public, anon, authenticated;
revoke all on function public.upsert_admin_shop_special_hours_v1(
  uuid, uuid, uuid, date, text, boolean, time without time zone, time without time zone, text, boolean, bigint, jsonb
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.update_admin_shop_identity_v1(
      uuid, uuid, text, text, text, numeric, numeric, bigint, text, text, text, numeric, numeric
    ) to service_role;
    grant execute on function public.upsert_admin_shop_weekly_hours_v1(
      uuid, uuid, uuid, text, smallint, time without time zone, time without time zone, boolean, bigint, jsonb
    ) to service_role;
    grant execute on function public.upsert_admin_shop_special_hours_v1(
      uuid, uuid, uuid, date, text, boolean, time without time zone, time without time zone, text, boolean, bigint, jsonb
    ) to service_role;
  end if;
end $$;

-- refundAllowed remains part of the canonical payment-method model, but until the trusted refund
-- execution boundary consumes the immutable transaction snapshot, this Plan 2 command may not
-- change the policy. This prevents a hidden API caller from advertising unenforced behavior.
create or replace function public.update_admin_payment_method_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_payment_method_id uuid,
  p_display_name text,
  p_active boolean,
  p_sort_order integer,
  p_channel text,
  p_requires_reference boolean,
  p_manual_confirmation_required boolean,
  p_refund_allowed boolean,
  p_expected_settings_version bigint,
  p_expected_edit_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_settings_version bigint;
  v_current_edit_version bigint;
  v_current_refund_allowed boolean;
  v_next_edit_version bigint;
begin
  if p_employee_id is null or p_shop_id is null or p_payment_method_id is null
     or nullif(btrim(p_display_name), '') is null
     or p_active is null or p_sort_order is null
     or p_channel not in ('POS', 'ONLINE', 'BOTH')
     or p_requires_reference is null or p_manual_confirmation_required is null
     or p_refund_allowed is null or p_expected_settings_version is null or p_expected_settings_version < 0
     or p_expected_edit_version is null or p_expected_edit_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payment_method_edit');
  end if;

  v_business_id := private.assert_admin_settings_permission_v1(p_employee_id, p_shop_id, 'settings.manage');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));
  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'shop_not_found');
  end if;

  select coalesce(max(s.settings_version), 0) into v_current_settings_version
  from public.shop_settings_versions s where s.shop_id = p_shop_id;
  if v_current_settings_version <> p_expected_settings_version then
    return jsonb_build_object('ok', false, 'code', 'stale_settings_version', 'currentVersion', v_current_settings_version);
  end if;

  select p.edit_version, p.refund_allowed
    into v_current_edit_version, v_current_refund_allowed
  from public.payment_methods p
  where p.id = p_payment_method_id and p.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_method_not_found');
  end if;
  if v_current_edit_version <> p_expected_edit_version then
    return jsonb_build_object('ok', false, 'code', 'stale_edit_version', 'currentVersion', v_current_edit_version);
  end if;
  if p_refund_allowed is distinct from v_current_refund_allowed then
    return jsonb_build_object('ok', false, 'code', 'refund_policy_not_editable_until_enforced');
  end if;

  v_next_edit_version := v_current_edit_version + 1;
  update public.payment_methods
  set display_name = btrim(p_display_name),
      active = p_active,
      sort_order = p_sort_order,
      channel = p_channel,
      requires_reference = p_requires_reference,
      manual_confirmation_required = p_manual_confirmation_required,
      edit_version = v_next_edit_version,
      updated_at = now()
  where id = p_payment_method_id and shop_id = p_shop_id;

  return jsonb_build_object('ok', true, 'editVersion', v_next_edit_version);
end;
$$;

revoke all on function public.update_admin_payment_method_v1(
  uuid, uuid, uuid, text, boolean, integer, text, boolean, boolean, boolean, bigint, bigint
) from public, anon, authenticated;
do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.update_admin_payment_method_v1(
      uuid, uuid, uuid, text, boolean, integer, text, boolean, boolean, boolean, bigint, bigint
    ) to service_role;
  end if;
end $$;

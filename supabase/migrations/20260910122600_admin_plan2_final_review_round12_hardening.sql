-- TUX Admin Plan 2 final review round 12 hardening.
-- Additive only: execute already-authorized scheduled catalog publications under scheduler authority.
-- The original employee remains immutable audit attribution, but current employee activation/permissions
-- are intentionally not re-evaluated after schedule_catalog_draft_v1 accepted the schedule.

create or replace function private.publish_admin_catalog_draft_authorized_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint,
  p_require_current_employee_authority boolean
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
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_pricing_changed boolean;
  v_rebase jsonb;
begin
  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_publishable');
  end if;

  if p_require_current_employee_authority then
    v_business_id := private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.publish'
    );
  else
    -- Scheduled execution is scheduler authority after durable acceptance. Keep the creator only
    -- as audit attribution and verify the historical employee belongs to the draft business.
    select e.business_id
      into v_business_id
    from public.business_employees e
    where e.id = p_employee_id;
  end if;

  if v_business_id is distinct from v_draft.business_id then
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

  if p_expected_base_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  if v_draft.base_publish_version <> v_current_publish_version then
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

  if v_draft.base_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_draft.shop_id;

  v_bundle := private.merge_catalog_owned_draft_bundle_v1(
    v_draft.shop_id,
    v_draft.working_bundle_json,
    v_current_operations_version,
    now()
  );

  select (
    exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'products') as next_product(
        id uuid, "priceMinor" bigint
      )
      left join public.products p
        on p.id = next_product.id and p.shop_id = v_draft.shop_id
      where p.id is null or p.price_minor is distinct from next_product."priceMinor"
    )
    or exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'modifiers') as next_modifier(
        id uuid, "priceMinor" bigint
      )
      left join public.modifiers m
        on m.id = next_modifier.id and m.shop_id = v_draft.shop_id
      where m.id is null or m.price_minor is distinct from next_modifier."priceMinor"
    )
  ) into v_pricing_changed;

  if p_require_current_employee_authority and v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    v_draft.shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );
  perform private.validate_admin_catalog_bundle_v1(v_draft.shop_id, v_bundle);

  perform private.publish_admin_catalog_configuration_v1(
    v_draft.shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(v_draft.shop_id, v_bundle);
  perform private.sync_admin_master_catalog_v1(v_draft.business_id, v_draft.shop_id);

  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, draft_id, published_by_employee_id, bundle_json, published_at
  ) values (
    v_draft.business_id, v_draft.shop_id, v_new_publish_version, v_new_operations_version,
    'DRAFT', v_draft.id, p_employee_id, v_bundle, now()
  );

  update public.catalog_drafts
  set status = 'PUBLISHED',
      working_bundle_json = v_bundle,
      published_version = v_new_publish_version,
      published_at = now(),
      updated_at = now()
  where id = v_draft.id;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

revoke all on function private.publish_admin_catalog_draft_authorized_v1(
  uuid, uuid, bigint, bigint, boolean
) from public, anon, authenticated;

create or replace function public.publish_catalog_draft_v1(
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
begin
  return private.publish_admin_catalog_draft_authorized_v1(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    p_expected_base_publish_version,
    true
  );
end;
$$;

revoke all on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;

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

  -- The schedule carries its original base fence. A persisted resume may have advanced the draft
  -- only across transient availability publications. Any catalog/config publication still stales it.
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

  -- schedule_catalog_draft_v1 already enforced catalog.publish and, when applicable,
  -- catalog.pricing on the exact draft revision/base that was durably accepted. Execution is now
  -- system/scheduler authority; p_employee_id is retained solely for immutable audit attribution.
  v_result := private.publish_admin_catalog_draft_authorized_v1(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    v_draft.base_publish_version,
    false
  );
  return v_result;
end;
$$;

revoke all on function public.publish_catalog_draft_scheduled_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.publish_catalog_draft_scheduled_v1(uuid, uuid, bigint, bigint)
      to service_role;
  end if;
end $$;

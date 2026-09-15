-- TUX Admin Plan 2 final review round 8 hardening.
-- Additive only: ordinary draft transient-availability rebasing and scheduled-draft edit fencing.

create or replace function private.rebase_admin_catalog_draft_transient_v1(
  p_draft_id uuid,
  p_expected_current_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_current_publish_version bigint;
  v_rebased_products jsonb;
begin
  if p_draft_id is null
     or p_expected_current_publish_version is null
     or p_expected_current_publish_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_editable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_draft.shop_id::text, 0));

  select coalesce(max(published.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions published
  where published.shop_id = v_draft.shop_id;

  if p_expected_current_publish_version <> v_current_publish_version
     or v_current_publish_version < v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  if v_current_publish_version = v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', true,
      'basePublishVersion', v_current_publish_version,
      'rebased', false
    );
  end if;

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

  -- Availability publications are transient authority. Preserve the draft's catalog-owned fields,
  -- but carry the current canonical soldOut value forward so resuming/publishing cannot resurrect
  -- stale availability state.
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

  return jsonb_build_object(
    'ok', true,
    'basePublishVersion', v_current_publish_version,
    'rebased', true
  );
end;
$$;

revoke all on function private.rebase_admin_catalog_draft_transient_v1(uuid, bigint)
  from public, anon, authenticated;

create or replace function public.apply_catalog_draft_change_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_change_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_business_id uuid;
  v_candidate_bundle jsonb;
  v_next_bundle jsonb;
  v_current_operations_version integer;
  v_new_revision bigint;
  v_pricing_changed boolean;
  v_claimed_schedule_id uuid;
begin
  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_editable');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, v_draft.shop_id, 'catalog.edit'
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
  if jsonb_typeof(p_change_json) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_change');
  end if;

  v_candidate_bundle := case
    when p_change_json ? 'bundleJson' then p_change_json -> 'bundleJson'
    else p_change_json
  end;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_draft.shop_id;

  v_next_bundle := private.merge_catalog_owned_draft_bundle_v1(
    v_draft.shop_id,
    v_candidate_bundle,
    v_current_operations_version,
    now()
  );

  select (
    exists (
      select 1
      from jsonb_to_recordset(v_next_bundle -> 'snapshot' -> 'products') as next_product(
        id uuid, "priceMinor" bigint
      )
      left join jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'products') as previous_product(
        id uuid, "priceMinor" bigint
      ) on previous_product.id = next_product.id
      where previous_product.id is null
         or previous_product."priceMinor" is distinct from next_product."priceMinor"
    )
    or exists (
      select 1
      from jsonb_to_recordset(v_next_bundle -> 'snapshot' -> 'modifiers') as next_modifier(
        id uuid, "priceMinor" bigint
      )
      left join jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'modifiers') as previous_modifier(
        id uuid, "priceMinor" bigint
      ) on previous_modifier.id = next_modifier.id
      where previous_modifier.id is null
         or previous_modifier."priceMinor" is distinct from next_modifier."priceMinor"
    )
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  -- Serialize against scheduler claims. If a worker owns the job already, fail closed and leave
  -- the draft revision untouched. Otherwise invalidate every retryable/live schedule before edit.
  perform s.id
  from public.scheduled_config_changes s
  where s.shop_id = v_draft.shop_id
    and s.change_kind = 'CATALOG_PUBLISH'
    and s.payload_json ->> 'draftId' = v_draft.id::text
    and s.status in ('PENDING', 'FAILED', 'CLAIMED')
  order by s.id
  for update;

  select s.id
    into v_claimed_schedule_id
  from public.scheduled_config_changes s
  where s.shop_id = v_draft.shop_id
    and s.change_kind = 'CATALOG_PUBLISH'
    and s.payload_json ->> 'draftId' = v_draft.id::text
    and s.status = 'CLAIMED'
  order by s.id
  limit 1;

  if v_claimed_schedule_id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'schedule_claimed',
      'scheduleId', v_claimed_schedule_id
    );
  end if;

  update public.scheduled_config_changes s
  set status = 'CANCELLED',
      claimed_at = null,
      next_attempt_at = null,
      terminal_failure = false,
      last_error = 'cancelled_by_draft_edit',
      updated_at = now()
  where s.shop_id = v_draft.shop_id
    and s.change_kind = 'CATALOG_PUBLISH'
    and s.payload_json ->> 'draftId' = v_draft.id::text
    and s.status in ('PENDING', 'FAILED');

  v_new_revision := v_draft.draft_revision + 1;

  insert into public.catalog_draft_changes(
    business_id, draft_id, sequence, employee_id,
    expected_draft_revision, change_json, resulting_bundle_json
  ) values (
    v_draft.business_id, v_draft.id, v_new_revision - 1, p_employee_id,
    p_expected_draft_revision, p_change_json, v_next_bundle
  );

  update public.catalog_drafts
  set working_bundle_json = v_next_bundle,
      draft_revision = v_new_revision,
      updated_at = now()
  where id = v_draft.id;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'draftRevision', v_new_revision,
    'basePublishVersion', v_draft.base_publish_version
  );
end;
$$;

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

  if v_pricing_changed then
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

  perform public.publish_tux_operations_configuration(
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
  v_rebase jsonb;
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

  if v_current_publish_version <> p_expected_current_publish_version then
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
      and d.shop_id = p_shop_id
    for update;
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

revoke all on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.resume_catalog_draft_v1(uuid, uuid, uuid, bigint)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb)
      to service_role;
    grant execute on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.resume_catalog_draft_v1(uuid, uuid, uuid, bigint)
      to service_role;
  end if;
end $$;

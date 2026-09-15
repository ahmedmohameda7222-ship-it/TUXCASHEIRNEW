-- TUX Admin Plan 2 Codex-review hardening.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Catalog drafts are a transport envelope, not authority for settings/inventory/configuration.

create or replace function private.merge_catalog_owned_draft_bundle_v1(
  p_shop_id uuid,
  p_candidate_bundle jsonb,
  p_operations_version integer,
  p_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_trusted jsonb;
  v_merged jsonb;
begin
  if p_shop_id is null
     or p_operations_version is null
     or p_operations_version < 0
     or p_updated_at is null
     or jsonb_typeof(p_candidate_bundle) <> 'object'
     or jsonb_typeof(p_candidate_bundle -> 'snapshot') <> 'object' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;

  -- Rebuild every non-catalog section from canonical/published authority. In particular this
  -- preserves inventoryItems and the latest immutable settings/order/payment/delivery/reason
  -- configuration instead of trusting copies carried in a browser-submitted bundle.
  v_trusted := private.build_admin_catalog_bundle_v1(
    p_shop_id,
    p_operations_version,
    p_updated_at
  );
  v_merged := v_trusted;

  v_merged := jsonb_set(
    v_merged,
    '{snapshot,categories}',
    p_candidate_bundle #> '{snapshot,categories}',
    false
  );
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,products}',
    p_candidate_bundle #> '{snapshot,products}',
    false
  );
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,modifiers}',
    p_candidate_bundle #> '{snapshot,modifiers}',
    false
  );
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,productModifierLinks}',
    p_candidate_bundle #> '{snapshot,productModifierLinks}',
    false
  );
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,comboBeverageOptions}',
    p_candidate_bundle #> '{snapshot,comboBeverageOptions}',
    false
  );
  -- Base recipe association is an approved Catalog capability. Inventory item definitions
  -- themselves stay protected because inventoryItems comes from v_trusted above.
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,recipeLines}',
    p_candidate_bundle #> '{snapshot,recipeLines}',
    false
  );

  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_merged);
  return v_merged;
end;
$$;

revoke all on function private.merge_catalog_owned_draft_bundle_v1(uuid, jsonb, integer, timestamptz)
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

  if p_expected_base_publish_version <> v_current_publish_version
     or v_draft.base_publish_version <> v_current_publish_version then
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

  -- Reconstruct protected sections at execution time so a long-lived catalog draft cannot
  -- roll back settings that were published after the draft was created/saved.
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

revoke all on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb)
      to service_role;
    grant execute on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
      to service_role;
  end if;
end $$;

-- TUX Admin Plan 2 final review hardening.
-- Additive only: validates changed draft image keys, makes scheduled draft publication replay-safe,
-- and removes settings that do not yet have a trusted execution contract.

create or replace function private.validate_admin_catalog_changed_image_keys_v1(
  p_shop_id uuid,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, storage, private
as $$
declare
  v_product record;
begin
  if p_shop_id is null
     or jsonb_typeof(p_bundle) <> 'object'
     or jsonb_typeof(p_bundle #> '{snapshot,products}') <> 'array' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;

  for v_product in
    select candidate.id, candidate."imageKey"
    from jsonb_to_recordset(p_bundle #> '{snapshot,products}') as candidate(
      id uuid,
      "imageKey" text
    )
    left join public.products current_product
      on current_product.id = candidate.id
     and current_product.shop_id = p_shop_id
    where candidate."imageKey" is not null
      and candidate."imageKey" <> ''
      and (
        current_product.id is null
        or current_product.image_key is distinct from candidate."imageKey"
      )
  loop
    if split_part(v_product."imageKey", '/', 1) <> p_shop_id::text
       or v_product."imageKey" !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,8}$' then
      raise exception 'TUX_ADMIN_CATALOG_IMAGE_KEY_FORBIDDEN';
    end if;

    if not exists (
      select 1
      from storage.objects object_row
      where object_row.bucket_id = 'catalog-product-images'
        and object_row.name = v_product."imageKey"
    ) then
      raise exception 'TUX_ADMIN_CATALOG_IMAGE_OBJECT_MISSING';
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_admin_catalog_changed_image_keys_v1(uuid, jsonb)
  from public, anon, authenticated;

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
  v_merged := jsonb_set(
    v_merged,
    '{snapshot,recipeLines}',
    p_candidate_bundle #> '{snapshot,recipeLines}',
    false
  );

  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_merged);
  perform private.validate_admin_catalog_changed_image_keys_v1(p_shop_id, v_merged);
  return v_merged;
end;
$$;

revoke all on function private.merge_catalog_owned_draft_bundle_v1(uuid, jsonb, integer, timestamptz)
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

  if p_expected_base_publish_version <> v_draft.base_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_draft.base_publish_version
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

  v_result := public.publish_catalog_draft_v1(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    p_expected_base_publish_version
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

create or replace function private.validate_admin_setting_value_v1(
  p_setting_key text,
  p_value_json jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_number numeric;
  v_text text;
begin
  if p_setting_key is null or p_value_json is null then
    return false;
  end if;

  case p_setting_key
    when 'checkout.minimumOrderMinor' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 9007199254740991;

    when 'checkout.serviceChargeBps', 'checkout.taxBps' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 0 and 10000;

    when 'checkout.requireCustomerPhone',
         'checkout.allowDiscountStacking',
         'checkout.allowDeliveryFeeOverride' then
      return jsonb_typeof(p_value_json) = 'boolean';

    when 'receipt.orderPrefix' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 64;

    when 'receipt.footer' then
      if jsonb_typeof(p_value_json) <> 'string' then return false; end if;
      v_text := p_value_json #>> '{}';
      return char_length(v_text) <= 1000;

    when 'receipt.sequenceStart' then
      if jsonb_typeof(p_value_json) <> 'number' then return false; end if;
      v_number := (p_value_json #>> '{}')::numeric;
      return v_number = trunc(v_number) and v_number between 1 and 9007199254740991;

    when 'receipt.sequenceResetPolicy' then
      return jsonb_typeof(p_value_json) = 'string'
        and (p_value_json #>> '{}') = 'BUSINESS_DAY';

    else
      return false;
  end case;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.validate_admin_setting_value_v1(text, jsonb)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function private.validate_admin_setting_value_v1(text, jsonb)
      to service_role;
  end if;
end $$;

-- TUX Admin Plan 2 JavaScript-safe catalog price hardening.
-- Catalog money crosses PostgreSQL -> JSON -> JavaScript, so trusted draft writes must stay
-- within Number.MAX_SAFE_INTEGER even though PostgreSQL bigint/numeric can represent more.

create or replace function private.validate_admin_catalog_safe_prices_v1(
  p_shop_id uuid,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_item jsonb;
  v_price numeric;
begin
  if p_shop_id is null
     or jsonb_typeof(p_bundle) <> 'object'
     or jsonb_typeof(p_bundle #> '{snapshot,products}') <> 'array'
     or jsonb_typeof(p_bundle #> '{snapshot,modifiers}') <> 'array' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_bundle #> '{snapshot,products}')
    union all
    select value from jsonb_array_elements(p_bundle #> '{snapshot,modifiers}')
  loop
    if jsonb_typeof(v_item -> 'priceMinor') <> 'number' then
      raise exception 'TUX_ADMIN_CATALOG_PRICE_INVALID';
    end if;
    begin
      v_price := (v_item ->> 'priceMinor')::numeric;
    exception
      when numeric_value_out_of_range or invalid_text_representation then
        raise exception 'TUX_ADMIN_CATALOG_PRICE_INVALID';
    end;
    if v_price <> trunc(v_price)
       or v_price < 0
       or v_price > 9007199254740991 then
      raise exception 'TUX_ADMIN_CATALOG_PRICE_OUT_OF_SAFE_RANGE';
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_admin_catalog_safe_prices_v1(uuid, jsonb)
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

  v_merged := jsonb_set(v_merged, '{snapshot,categories}', p_candidate_bundle #> '{snapshot,categories}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,products}', p_candidate_bundle #> '{snapshot,products}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,modifiers}', p_candidate_bundle #> '{snapshot,modifiers}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,productModifierLinks}', p_candidate_bundle #> '{snapshot,productModifierLinks}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,comboBeverageOptions}', p_candidate_bundle #> '{snapshot,comboBeverageOptions}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,recipeLines}', p_candidate_bundle #> '{snapshot,recipeLines}', false);

  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_merged);
  perform private.validate_admin_catalog_safe_prices_v1(p_shop_id, v_merged);
  perform private.validate_admin_catalog_changed_image_keys_v1(p_shop_id, v_merged);
  return v_merged;
end;
$$;

revoke all on function private.merge_catalog_owned_draft_bundle_v1(uuid, jsonb, integer, timestamptz)
  from public, anon, authenticated;

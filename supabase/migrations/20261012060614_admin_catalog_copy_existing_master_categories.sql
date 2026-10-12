-- Extends version-fenced selective Catalog Copy to existing master-mapped categories.
-- This migration only changes trusted functions; no live categories/products are rewritten.
create or replace function private.build_admin_catalog_copy_existing_products_v1(
  p_employee_id uuid,
  p_source_shop_id uuid,
  p_target_shop_id uuid,
  p_target_draft_id uuid,
  p_source_publish_version bigint,
  p_target_publish_version bigint,
  p_target_draft_revision bigint,
  p_domains text[]
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,private
as $copy$
declare
  v_business uuid;
  v_target_business uuid;
  v_draft public.catalog_drafts%rowtype;
  v_source_bundle jsonb;
  v_src_products jsonb;
  v_target_products jsonb;
  v_source_categories jsonb;
  v_target_categories jsonb;
  v_result_categories jsonb;
  v_category_map jsonb := '{}'::jsonb;
  v_source_category_count bigint := 0;
  v_mapped_category_count bigint := 0;
  v_changed_category_count bigint := 0;
  v_category_differences jsonb := '[]'::jsonb;
  v_mapped jsonb;
  v_bundle jsonb;
  v_result_products jsonb;
  v_source_count bigint;
  v_mapped_count bigint;
  v_changed_count bigint;
  v_differences jsonb;
  v_target_version bigint;
  v_source_version bigint;
  v_fingerprint text;
begin
  if p_employee_id is null or p_source_shop_id is null or
     p_target_shop_id is null or p_target_draft_id is null or
     p_source_shop_id=p_target_shop_id or
     p_source_publish_version is null or p_source_publish_version < 0 or
     p_target_publish_version is null or p_target_publish_version < 0 or
     p_target_draft_revision is null or p_target_draft_revision <= 0 or
     p_domains is null or cardinality(p_domains) < 1 or cardinality(p_domains) > 4 or
     exists(select 1 from unnest(p_domains) d
       where d is null or d not in ('productPrices','productAvailability','categoryOrder','categoryAvailability')) or
     (select count(distinct d) from unnest(p_domains) d)<>cardinality(p_domains)
  then return jsonb_build_object('ok',false,'code','invalid_catalog_copy_request');
  end if;

  v_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_source_shop_id,'catalog.view');
  v_target_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_target_shop_id,'catalog.edit');
  if v_business is distinct from v_target_business then
    return jsonb_build_object('ok',false,'code','cross_business_copy_forbidden');
  end if;
  if 'productPrices'=any(p_domains) then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id,p_target_shop_id,'catalog.pricing'
    );
  end if;
  if exists(
    select 1 from public.shops s
    where s.id in (p_source_shop_id,p_target_shop_id)
      and (s.active is distinct from true or s.lifecycle_state<>'ACTIVE')
  ) or (select count(*) from public.shops
       where id in (p_source_shop_id,p_target_shop_id))<>2
  then return jsonb_build_object('ok',false,'code','catalog_copy_shop_inactive');
  end if;

  select * into v_draft from public.catalog_drafts
  where id=p_target_draft_id and business_id=v_business
    and shop_id=p_target_shop_id;
  if not found or v_draft.status<>'DRAFT' then
    return jsonb_build_object('ok',false,'code','catalog_copy_target_draft_invalid');
  end if;
  if v_draft.draft_revision<>p_target_draft_revision then
    return jsonb_build_object('ok',false,'code','stale_draft_revision');
  end if;
  select coalesce(max(publish_version),0) into v_source_version
  from public.catalog_publish_versions where shop_id=p_source_shop_id
    and business_id=v_business;
  select coalesce(max(publish_version),0) into v_target_version
  from public.catalog_publish_versions where shop_id=p_target_shop_id
    and business_id=v_business;
  if v_source_version<>p_source_publish_version or
     v_target_version<>p_target_publish_version or
     v_draft.base_publish_version<>p_target_publish_version
  then return jsonb_build_object('ok',false,'code','stale_catalog_copy_preview'); end if;
  select bundle_json into v_source_bundle
  from public.catalog_publish_versions
  where shop_id=p_source_shop_id and business_id=v_business
    and publish_version=p_source_publish_version;
  if not found then return jsonb_build_object('ok',false,'code','catalog_copy_source_unpublished'); end if;
  v_src_products:=v_source_bundle->'snapshot'->'products';
  v_target_products:=v_draft.working_bundle_json->'snapshot'->'products';
  if jsonb_typeof(v_src_products)<>'array' or
     jsonb_typeof(v_target_products)<>'array'
  then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;

  -- Stable mapping uses the existing business-level master product identity.
  -- The canonical source/target product IDs remain different and never leak.
  select count(*) into v_source_count from jsonb_array_elements(v_src_products);
  select count(*),coalesce(jsonb_object_agg(
      tgt.canonical_product_id::text,src.value
    ),'{}'::jsonb)
    into v_mapped_count,v_mapped
  from jsonb_array_elements(v_src_products) src(value)
  join public.catalog_product_shop_overrides org
    on org.business_id=v_business and org.shop_id=p_source_shop_id
   and org.canonical_product_id=(src.value->>'id')::uuid
  join public.catalog_product_shop_overrides tgt
    on tgt.business_id=v_business and tgt.shop_id=p_target_shop_id
   and tgt.master_product_id=org.master_product_id
  where exists(
    select 1 from jsonb_array_elements(v_target_products) item
    where item->>'id'=tgt.canonical_product_id::text
  );
  if ('productPrices'=any(p_domains) or 'productAvailability'=any(p_domains))
    and (v_source_count=0 or v_source_count<>v_mapped_count) then
    return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
  end if;
  if ('productPrices'=any(p_domains) or 'productAvailability'=any(p_domains))
    and (select count(distinct id) from jsonb_object_keys(v_mapped) id)<>v_source_count then
    return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
  end if;

  select coalesce(jsonb_agg(
    case when v_mapped ? (item.value->>'id')
      then
        (case when 'productPrices'=any(p_domains)
          then jsonb_set(item.value,'{priceMinor}',
            v_mapped->(item.value->>'id')->'priceMinor')
          else item.value end) ||
        (case when 'productAvailability'=any(p_domains)
          then jsonb_build_object(
            'active',v_mapped->(item.value->>'id')->'active',
            'soldOut',v_mapped->(item.value->>'id')->'soldOut'
          ) else '{}'::jsonb end)
      else item.value end
    order by item.ordinality
  ),'[]'::jsonb) into v_result_products
  from jsonb_array_elements(v_target_products) with ordinality item(value,ordinality);

  v_bundle:=jsonb_set(v_draft.working_bundle_json,'{snapshot,products}',
                      v_result_products,false);

  -- Only fields requested by the actor are remapped. Distinct category IDs,
  -- names, shop ownership and any unmapped dependencies remain unchanged.
  if 'categoryOrder'=any(p_domains) or 'categoryAvailability'=any(p_domains) then
    v_source_categories:=v_source_bundle->'snapshot'->'categories';
    v_target_categories:=v_draft.working_bundle_json->'snapshot'->'categories';
    if jsonb_typeof(v_source_categories)<>'array' or
       jsonb_typeof(v_target_categories)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;
    select count(*) into v_source_category_count
    from jsonb_array_elements(v_source_categories);
    select count(*),coalesce(jsonb_object_agg(
      tgt.canonical_category_id::text,src.value
    ),'{}'::jsonb)
      into v_mapped_category_count,v_category_map
    from jsonb_array_elements(v_source_categories) src(value)
    join public.catalog_category_shop_bindings original
      on original.business_id=v_business
     and original.shop_id=p_source_shop_id
     and original.canonical_category_id=(src.value->>'id')::uuid
    join public.catalog_category_shop_bindings tgt
      on tgt.business_id=v_business
     and tgt.shop_id=p_target_shop_id
     and tgt.master_category_id=original.master_category_id
    where exists(
      select 1 from jsonb_array_elements(v_target_categories) entry
      where entry->>'id'=tgt.canonical_category_id::text
    );
    if v_source_category_count=0 or
       v_mapped_category_count<>v_source_category_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies'); end if;
    if (select count(distinct id) from jsonb_object_keys(v_category_map) id)
       <>v_source_category_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision'); end if;
    select coalesce(jsonb_agg(
      case when v_category_map ? (item.value->>'id') then
        (case when 'categoryOrder'=any(p_domains) then
          jsonb_set(item.value,'{sortOrder}',v_category_map->(item.value->>'id')->'sortOrder')
        else item.value end) ||
        (case when 'categoryAvailability'=any(p_domains) then
          jsonb_build_object('active',v_category_map->(item.value->>'id')->'active')
        else '{}'::jsonb end)
      else item.value end
      order by item.ordinality
    ),'[]'::jsonb) into v_result_categories
    from jsonb_array_elements(v_target_categories) with ordinality item(value,ordinality);
    v_bundle:=jsonb_set(v_bundle,'{snapshot,categories}',v_result_categories,false);
    select count(*) into v_changed_category_count
    from jsonb_array_elements(v_target_categories) with ordinality before_item(value,idx)
    join jsonb_array_elements(v_result_categories) with ordinality after_item(value,idx)
      on before_item.idx=after_item.idx
    where before_item.value is distinct from after_item.value;
    select coalesce(jsonb_agg(jsonb_build_object(
      'targetCategoryId',old_row.value->>'id',
      'categoryName',old_row.value->>'name',
      'sortOrderBefore',old_row.value->'sortOrder',
      'sortOrderAfter',new_row.value->'sortOrder',
      'activeBefore',old_row.value->'active',
      'activeAfter',new_row.value->'active'
    ) order by old_row.ordinality),'[]'::jsonb)
    into v_category_differences
    from jsonb_array_elements(v_target_categories) with ordinality old_row(value,ordinality)
    join jsonb_array_elements(v_result_categories) with ordinality new_row(value,ordinality)
      on old_row.ordinality=new_row.ordinality
    where old_row.value is distinct from new_row.value;
  end if;
  perform private.validate_admin_catalog_bundle_v1(p_target_shop_id,v_bundle);
  select count(*) into v_changed_count
  from jsonb_array_elements(v_target_products) with ordinality before_item(value,idx)
  join jsonb_array_elements(v_result_products) with ordinality after_item(value,idx)
    on before_item.idx=after_item.idx
  where before_item.value is distinct from after_item.value;
  select coalesce(jsonb_agg(jsonb_build_object(
    'targetProductId',old_row.value->>'id',
    'productName',old_row.value->>'name',
    'priceBeforeMinor',old_row.value->'priceMinor',
    'priceAfterMinor',new_row.value->'priceMinor',
    'activeBefore',old_row.value->'active',
    'activeAfter',new_row.value->'active',
    'soldOutBefore',old_row.value->'soldOut',
    'soldOutAfter',new_row.value->'soldOut'
  ) order by old_row.ordinality),'[]'::jsonb)
  into v_differences
  from jsonb_array_elements(v_target_products) with ordinality old_row(value,ordinality)
  join jsonb_array_elements(v_result_products) with ordinality new_row(value,ordinality)
    on old_row.ordinality=new_row.ordinality
  where old_row.value is distinct from new_row.value;
  v_fingerprint:=encode(extensions.digest(
    jsonb_build_object('business',v_business,'sourceShop',p_source_shop_id,
      'targetShop',p_target_shop_id,'draft',p_target_draft_id,
      'sourceVersion',p_source_publish_version,'targetVersion',p_target_publish_version,
      'revision',p_target_draft_revision,'domains',to_jsonb(p_domains),
      'candidate',v_bundle)::text,'sha256'),'hex');
  return jsonb_build_object(
    'ok',true,'businessId',v_business,'sourceShopId',p_source_shop_id,
    'targetShopId',p_target_shop_id,'targetDraftId',p_target_draft_id,
    'expectedSourcePublishVersion',p_source_publish_version,
    'expectedTargetPublishVersion',p_target_publish_version,
    'expectedTargetDraftRevision',p_target_draft_revision,
    'selectedDomains',to_jsonb(p_domains),
    'mappedProducts',v_mapped_count,'changedProducts',v_changed_count,
    'differences',v_differences,
    'mappedCategories',v_mapped_category_count,'changedCategories',v_changed_category_count,
    'categoryDifferences',v_category_differences,
    'fingerprint',v_fingerprint,'candidateBundle',v_bundle
  );
end;
$copy$;
create or replace function public.apply_admin_catalog_shop_copy_v1(
  p_employee_id uuid,p_source_shop_id uuid,p_target_shop_id uuid,
  p_target_draft_id uuid,p_source_publish_version bigint,
  p_target_publish_version bigint,p_target_draft_revision bigint,
  p_domains text[],p_preview_fingerprint text,p_command_id text
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,private
as $apply$
declare
  v_business uuid;
  v_target_business uuid;
  v_receipt public.admin_catalog_copy_receipts%rowtype;
  v_plan jsonb;
  v_saved jsonb;
  v_result jsonb;
begin
  if nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 or
     p_preview_fingerprint is null or
     length(p_preview_fingerprint) <> 64 or
     p_preview_fingerprint ~ '[^0-9a-f]'
  then return jsonb_build_object('ok',false,'code','invalid_catalog_copy_apply'); end if;
  if p_source_shop_id=p_target_shop_id or p_domains is null then
    return jsonb_build_object('ok',false,'code','invalid_catalog_copy_apply');
  end if;
  v_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_source_shop_id,'catalog.view');
  v_target_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_target_shop_id,'catalog.edit');
  if v_business is distinct from v_target_business then
    return jsonb_build_object('ok',false,'code','cross_business_copy_forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'tux-admin-catalog-copy:'||v_business::text||':'||p_target_shop_id::text||
    ':'||p_command_id,0
  ));
  select * into v_receipt from public.admin_catalog_copy_receipts
  where business_id=v_business and target_shop_id=p_target_shop_id
    and command_id=p_command_id for update;
  if found then
    if v_receipt.source_shop_id<>p_source_shop_id or
       v_receipt.target_draft_id<>p_target_draft_id or
       v_receipt.preview_fingerprint<>p_preview_fingerprint
    then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
    return v_receipt.result_json||jsonb_build_object('replayed',true);
  end if;
  -- Draft lock first, exactly as canonical draft publication does.
  perform 1 from public.catalog_drafts where id=p_target_draft_id for update;
  if p_source_shop_id::text<p_target_shop_id::text then
    perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_source_shop_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_target_shop_id::text,0));
  else
    perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_target_shop_id::text,0));
    perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:'||p_source_shop_id::text,0));
  end if;
  v_plan:=private.build_admin_catalog_copy_existing_products_v1(
    p_employee_id,p_source_shop_id,p_target_shop_id,p_target_draft_id,
    p_source_publish_version,p_target_publish_version,p_target_draft_revision,p_domains
  );
  if v_plan->>'ok' is distinct from 'true' then return v_plan; end if;
  if v_plan->>'fingerprint'<>p_preview_fingerprint then
    return jsonb_build_object('ok',false,'code','stale_catalog_copy_preview'); end if;
  v_saved:=public.apply_catalog_draft_change_v1(
    p_employee_id,p_target_draft_id,p_target_draft_revision,
    jsonb_build_object('bundleJson',v_plan->'candidateBundle')
  );
  if v_saved->>'ok' is distinct from 'true' then
    return v_saved; end if;
  v_result:=jsonb_build_object(
    'ok',true,'targetDraftId',p_target_draft_id,
    'draftRevision',v_saved->'draftRevision',
    'mappedProducts',v_plan->'mappedProducts',
    'changedProducts',v_plan->'changedProducts',
    'mappedCategories',v_plan->'mappedCategories',
    'changedCategories',v_plan->'changedCategories',
    'publishRequired',true,'fingerprint',p_preview_fingerprint
  );
  insert into public.admin_catalog_copy_receipts(
    business_id,target_shop_id,command_id,source_shop_id,target_draft_id,
    actor_employee_id,preview_fingerprint,result_json
  ) values (
    v_business,p_target_shop_id,p_command_id,p_source_shop_id,p_target_draft_id,
    p_employee_id,p_preview_fingerprint,v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business,p_target_shop_id,p_employee_id,
    'CATALOG_COPY_STAGED','CATALOG_DRAFT',p_target_draft_id::text,
    jsonb_build_object('draftRevision',p_target_draft_revision),
    jsonb_build_object('draftRevision',v_saved->'draftRevision',
      'sourceShopId',p_source_shop_id,'sourcePublishVersion',p_source_publish_version,
      'targetPublishVersion',p_target_publish_version,'domains',to_jsonb(p_domains),
      'mappedProducts',v_plan->'mappedProducts','changedProducts',v_plan->'changedProducts',
      'mappedCategories',v_plan->'mappedCategories','changedCategories',v_plan->'changedCategories'),
    'Selective master-mapped product configuration copy',
    null,null,jsonb_build_object('commandId',p_command_id,'fingerprint',p_preview_fingerprint)
  );
  return v_result;
end;
$apply$;

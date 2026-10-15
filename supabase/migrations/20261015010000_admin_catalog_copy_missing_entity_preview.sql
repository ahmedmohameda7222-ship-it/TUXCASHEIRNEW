-- Approved Plan 2 / PR #119: trusted, read-only missing-entity preview.
-- This intentionally does NOT create target-local rows, master bindings, or
-- draft mutations. It classifies identities before the transactional copy.
create or replace function public.preview_admin_catalog_missing_entities_v1(
  p_employee_id uuid,
  p_source_shop_id uuid,
  p_target_shop_id uuid,
  p_target_draft_id uuid,
  p_source_publish_version bigint,
  p_target_publish_version bigint,
  p_target_draft_revision bigint
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $missing$
declare
  v_business_id uuid;
  v_target_business_id uuid;
  v_draft public.catalog_drafts%rowtype;
  v_source_bundle jsonb;
  v_categories jsonb;
  v_products jsonb;
  v_current_source bigint;
  v_current_target bigint;
begin
  if p_employee_id is null or p_source_shop_id is null or
     p_target_shop_id is null or p_target_draft_id is null or
     p_source_shop_id = p_target_shop_id or
     p_source_publish_version is null or p_source_publish_version <= 0 or
     p_target_publish_version is null or p_target_publish_version < 0 or
     p_target_draft_revision is null or p_target_draft_revision <= 0
  then
    return jsonb_build_object('ok',false,'code','invalid_catalog_copy_request');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id,p_source_shop_id,'catalog.view'
  );
  v_target_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id,p_target_shop_id,'catalog.edit'
  );
  if v_business_id is distinct from v_target_business_id then
    return jsonb_build_object('ok',false,'code','cross_business_copy_forbidden');
  end if;

  if (select count(*) from public.shops s
      where s.id in (p_source_shop_id,p_target_shop_id)
        and s.active is true and s.lifecycle_state='ACTIVE') <> 2
  then
    return jsonb_build_object('ok',false,'code','catalog_copy_shop_inactive');
  end if;

  select * into v_draft from public.catalog_drafts d
  where d.id=p_target_draft_id
    and d.business_id=v_business_id
    and d.shop_id=p_target_shop_id
    and d.status='DRAFT';
  if not found then
    return jsonb_build_object('ok',false,'code','catalog_copy_target_draft_invalid');
  end if;
  if v_draft.draft_revision<>p_target_draft_revision then
    return jsonb_build_object('ok',false,'code','stale_draft_revision');
  end if;

  select coalesce(max(publish_version),0) into v_current_source
  from public.catalog_publish_versions
  where business_id=v_business_id and shop_id=p_source_shop_id;
  select coalesce(max(publish_version),0) into v_current_target
  from public.catalog_publish_versions
  where business_id=v_business_id and shop_id=p_target_shop_id;
  if v_current_source<>p_source_publish_version or
     v_current_target<>p_target_publish_version or
     v_draft.base_publish_version<>p_target_publish_version
  then
    return jsonb_build_object('ok',false,'code','stale_catalog_copy_preview');
  end if;

  select bundle_json into v_source_bundle
  from public.catalog_publish_versions
  where business_id=v_business_id and shop_id=p_source_shop_id
    and publish_version=p_source_publish_version;
  if not found then
    return jsonb_build_object('ok',false,'code','catalog_copy_source_unpublished');
  end if;
  if jsonb_typeof(v_source_bundle->'snapshot'->'categories')<>'array' or
     jsonb_typeof(v_source_bundle->'snapshot'->'products')<>'array' or
     jsonb_typeof(v_draft.working_bundle_json->'snapshot'->'categories')<>'array' or
     jsonb_typeof(v_draft.working_bundle_json->'snapshot'->'products')<>'array'
  then
    return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid');
  end if;

  -- Matching normalized display names signal ambiguity only; they NEVER
  -- resolve or create a business-master identity.
  with findings as (
    select src.ordinality, src.value,
      source_binding.master_category_id,
      target_binding.canonical_category_id,
      name_collision.id as collision_id,
      case
        when source_master.id is null then 'MISSING_SOURCE_MASTER'
        when target_binding.master_category_id is not null
         and target_in_draft.id is null then 'TARGET_MAPPING_OUTSIDE_DRAFT'
        when target_binding.master_category_id is not null then 'MAPPED'
        when name_collision.id is not null then 'CONFLICT_NAME'
        else 'CREATE_REQUIRED'
      end as status
    from jsonb_array_elements(v_source_bundle->'snapshot'->'categories')
      with ordinality src(value,ordinality)
    left join public.catalog_category_shop_bindings source_binding
      on source_binding.business_id=v_business_id
     and source_binding.shop_id=p_source_shop_id
     and source_binding.canonical_category_id=(src.value->>'id')::uuid
    left join public.catalog_master_categories source_master
      on source_master.business_id=v_business_id
     and source_master.id=source_binding.master_category_id
    left join public.catalog_category_shop_bindings target_binding
      on target_binding.business_id=v_business_id
     and target_binding.shop_id=p_target_shop_id
     and target_binding.master_category_id=source_binding.master_category_id
    left join lateral (
      select (item.value->>'id')::uuid as id
      from jsonb_array_elements(v_draft.working_bundle_json->'snapshot'->'categories')
        item(value)
      where item.value->>'id'=target_binding.canonical_category_id::text
      limit 1
    ) target_in_draft on true
    left join lateral (
      select (item.value->>'id')::uuid as id
      from jsonb_array_elements(v_draft.working_bundle_json->'snapshot'->'categories')
        item(value)
      where lower(btrim(item.value->>'name'))=lower(btrim(src.value->>'name'))
        and (target_binding.canonical_category_id is null or
             item.value->>'id'<>target_binding.canonical_category_id::text)
      limit 1
    ) name_collision on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceCategoryId',value->>'id',
    'sourceName',value->>'name',
    'masterCategoryId',master_category_id,
    'targetCategoryId',canonical_category_id,
    'conflictingTargetCategoryId',collision_id,
    'status',status
  ) order by ordinality),'[]'::jsonb)
  into v_categories from findings;

  with findings as (
    select src.ordinality,src.value,
      source_binding.master_product_id,
      source_category.master_category_id,
      source_master.master_category_id as product_master_category_id,
      target_binding.canonical_product_id,
      target_category.canonical_category_id,
      name_collision.id as collision_id,
      case
        when source_master.id is null or source_category.master_category_id is null
          then 'MISSING_SOURCE_MASTER'
        when source_master.master_category_id is distinct from
             source_category.master_category_id then 'INVALID_MASTER_CATEGORY'
        when target_category.master_category_id is not null and
             target_category_in_draft.id is null then 'TARGET_MAPPING_OUTSIDE_DRAFT'
        when target_binding.master_product_id is not null
          and target_in_draft.id is null then 'TARGET_MAPPING_OUTSIDE_DRAFT'
        when target_binding.master_product_id is not null then 'MAPPED'
        when name_collision.id is not null then 'CONFLICT_NAME'
        else 'CREATE_REQUIRED'
      end as status
    from jsonb_array_elements(v_source_bundle->'snapshot'->'products')
      with ordinality src(value,ordinality)
    left join public.catalog_product_shop_overrides source_binding
      on source_binding.business_id=v_business_id
     and source_binding.shop_id=p_source_shop_id
     and source_binding.canonical_product_id=(src.value->>'id')::uuid
    left join public.catalog_master_products source_master
      on source_master.business_id=v_business_id
     and source_master.id=source_binding.master_product_id
    left join public.catalog_category_shop_bindings source_category
      on source_category.business_id=v_business_id
     and source_category.shop_id=p_source_shop_id
     and source_category.canonical_category_id=(src.value->>'categoryId')::uuid
    left join public.catalog_category_shop_bindings target_category
      on target_category.business_id=v_business_id
     and target_category.shop_id=p_target_shop_id
     and target_category.master_category_id=source_category.master_category_id
    left join lateral (
      select (item.value->>'id')::uuid as id
      from jsonb_array_elements(v_draft.working_bundle_json->'snapshot'->'categories')
        item(value)
      where item.value->>'id'=target_category.canonical_category_id::text
      limit 1
    ) target_category_in_draft on true
    left join public.catalog_product_shop_overrides target_binding
      on target_binding.business_id=v_business_id
     and target_binding.shop_id=p_target_shop_id
     and target_binding.master_product_id=source_binding.master_product_id
    left join lateral (
      select (item.value->>'id')::uuid as id
      from jsonb_array_elements(v_draft.working_bundle_json->'snapshot'->'products')
        item(value)
      where item.value->>'id'=target_binding.canonical_product_id::text
      limit 1
    ) target_in_draft on true
    left join lateral (
      select (item.value->>'id')::uuid as id
      from jsonb_array_elements(v_draft.working_bundle_json->'snapshot'->'products')
        item(value)
      where lower(btrim(item.value->>'name'))=lower(btrim(src.value->>'name'))
        and (target_binding.canonical_product_id is null or
             item.value->>'id'<>target_binding.canonical_product_id::text)
      limit 1
    ) name_collision on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceProductId',value->>'id',
    'sourceName',value->>'name',
    'sourceCategoryId',value->>'categoryId',
    'masterProductId',master_product_id,
    'masterCategoryId',master_category_id,
    'targetProductId',canonical_product_id,
    'targetCategoryId',canonical_category_id,
    'conflictingTargetProductId',collision_id,
    'status',status
  ) order by ordinality),'[]'::jsonb)
  into v_products from findings;

  return jsonb_build_object(
    'ok',true,'sourceShopId',p_source_shop_id,
    'targetShopId',p_target_shop_id,'targetDraftId',p_target_draft_id,
    'expectedSourcePublishVersion',p_source_publish_version,
    'expectedTargetPublishVersion',p_target_publish_version,
    'expectedTargetDraftRevision',p_target_draft_revision,
    'categories',v_categories,'products',v_products,
    'missingCategories',(select count(*) from jsonb_array_elements(v_categories) x(value)
      where x.value->>'status'='CREATE_REQUIRED'),
    'missingProducts',(select count(*) from jsonb_array_elements(v_products) x(value)
      where x.value->>'status'='CREATE_REQUIRED'),
    'conflicts',(select count(*) from (
      select x.value from jsonb_array_elements(v_categories) x(value)
      union all
      select x.value from jsonb_array_elements(v_products) x(value)
    ) all_entities where all_entities.value->>'status' not in ('MAPPED','CREATE_REQUIRED')),
    'allCategoriesAndProductsMapped',not exists(
      select 1 from jsonb_array_elements(v_categories || v_products) x(value)
      where x.value->>'status'<>'MAPPED'
    )
  );
end;
$missing$;

revoke all on function public.preview_admin_catalog_missing_entities_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.preview_admin_catalog_missing_entities_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint
) to service_role;

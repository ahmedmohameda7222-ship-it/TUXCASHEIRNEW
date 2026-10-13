-- Correction A: selective recipe lines through explicit inventory masters.
-- Full target-bundle validation and CAS; no inventory ledger/COGS source writes.
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
  v_assignment_map jsonb := '{}'::jsonb;
  v_source_to_target_product_map jsonb := '{}'::jsonb;
  v_source_combo_options jsonb;
  v_target_combo_options jsonb;
  v_affected_target_combos jsonb := '[]'::jsonb;
  v_translated_combo_options jsonb := '[]'::jsonb;
  v_preserved_combo_options jsonb := '[]'::jsonb;
  v_result_combo_options jsonb := '[]'::jsonb;
  v_mapped_combo_count bigint := 0;
  v_changed_combo_count bigint := 0;
  v_combo_differences jsonb := '[]'::jsonb;
  v_source_modifier_links jsonb;
  v_target_modifier_links jsonb;
  v_source_modifiers jsonb;
  v_target_modifiers jsonb;
  v_modifier_map jsonb := '{}'::jsonb;
  v_affected_link_products jsonb := '[]'::jsonb;
  v_translated_modifier_links jsonb := '[]'::jsonb;
  v_preserved_modifier_links jsonb := '[]'::jsonb;
  v_result_modifier_links jsonb := '[]'::jsonb;
  v_modifier_ref_count bigint := 0;
  v_modifier_mapped_count bigint := 0;
  v_modifier_distinct_count bigint := 0;
  v_mapped_modifier_links bigint := 0;
  v_changed_modifier_links bigint := 0;
  v_modifier_link_differences jsonb := '[]'::jsonb;
  v_modifier_definition_map jsonb := '{}'::jsonb;
  v_result_modifiers jsonb := '[]'::jsonb;
  v_source_modifier_count bigint := 0;
  v_mapped_modifier_definitions bigint := 0;
  v_distinct_modifier_definitions bigint := 0;
  v_changed_modifier_definitions bigint := 0;
  v_modifier_definition_differences jsonb := '[]'::jsonb;
  v_source_recipe_lines jsonb;
  v_target_recipe_lines jsonb;
  v_source_inventory jsonb;
  v_target_inventory jsonb;
  v_inventory_item_map jsonb := '{}'::jsonb;
  v_required_inventory_count bigint := 0;
  v_mapped_inventory_count bigint := 0;
  v_distinct_inventory_count bigint := 0;
  v_affected_recipe_products jsonb := '[]'::jsonb;
  v_translated_recipe_lines jsonb := '[]'::jsonb;
  v_preserved_recipe_lines jsonb := '[]'::jsonb;
  v_result_recipe_lines jsonb := '[]'::jsonb;
  v_mapped_recipe_lines bigint := 0;
  v_changed_recipe_lines bigint := 0;
  v_recipe_differences jsonb := '[]'::jsonb;
  v_assignment_categories bigint := 0;
  v_assignment_mapped bigint := 0;
  v_assignment_distinct bigint := 0;
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
     p_domains is null or cardinality(p_domains) < 1 or cardinality(p_domains) > 10 or
     exists(select 1 from unnest(p_domains) d
       where d is null or d not in ('productPrices','productAvailability','categoryOrder','categoryAvailability','productOrder','productCategoryAssignments','comboBeverageOptions','productModifierLinks','modifierDefinitions','recipeLines')) or
     (select count(distinct d) from unnest(p_domains) d)<>cardinality(p_domains)
  then return jsonb_build_object('ok',false,'code','invalid_catalog_copy_request');
  end if;

  v_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_source_shop_id,'catalog.view');
  v_target_business:=private.assert_admin_catalog_permission_v1(p_employee_id,p_target_shop_id,'catalog.edit');
  if v_business is distinct from v_target_business then
    return jsonb_build_object('ok',false,'code','cross_business_copy_forbidden');
  end if;
  if 'productPrices'=any(p_domains) or 'modifierDefinitions'=any(p_domains) then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id,p_target_shop_id,'catalog.pricing'
    );
  end if;
  if 'recipeLines'=any(p_domains) then
    perform private.assert_admin_catalog_permission_v1(p_employee_id,p_source_shop_id,'inventory.view');
    perform private.assert_admin_catalog_permission_v1(p_employee_id,p_target_shop_id,'inventory.adjust');
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
  if ('productPrices'=any(p_domains) or 'productAvailability'=any(p_domains) or 'productOrder'=any(p_domains) or 'productCategoryAssignments'=any(p_domains) or 'comboBeverageOptions'=any(p_domains) or 'productModifierLinks'=any(p_domains) or 'modifierDefinitions'=any(p_domains) or 'recipeLines'=any(p_domains))
    and (v_source_count=0 or v_source_count<>v_mapped_count) then
    return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
  end if;
  if ('productPrices'=any(p_domains) or 'productAvailability'=any(p_domains) or 'productOrder'=any(p_domains) or 'productCategoryAssignments'=any(p_domains) or 'comboBeverageOptions'=any(p_domains) or 'productModifierLinks'=any(p_domains) or 'modifierDefinitions'=any(p_domains) or 'recipeLines'=any(p_domains))
    and (select count(distinct id) from jsonb_object_keys(v_mapped) id)<>v_source_count then
    return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
  end if;

  -- Only source categories actually referenced by mapped products are needed.
  -- Resolve source and target through business-master bindings, never names/IDs.
  if 'productCategoryAssignments'=any(p_domains) then
    v_source_categories:=v_source_bundle->'snapshot'->'categories';
    v_target_categories:=v_draft.working_bundle_json->'snapshot'->'categories';
    if jsonb_typeof(v_source_categories)<>'array' or
       jsonb_typeof(v_target_categories)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;
    select count(*) into v_assignment_categories
    from (select distinct (entry.value->>'categoryId')::uuid as category_id
          from jsonb_each(v_mapped) entry(key,value)) required;
    select count(*),count(distinct target.canonical_category_id),
           coalesce(jsonb_object_agg(
             required.category_id::text,to_jsonb(target.canonical_category_id)
           ),'{}'::jsonb)
      into v_assignment_mapped,v_assignment_distinct,v_assignment_map
    from (select distinct (entry.value->>'categoryId')::uuid as category_id
          from jsonb_each(v_mapped) entry(key,value)) required
    join public.catalog_category_shop_bindings original
      on original.business_id=v_business
     and original.shop_id=p_source_shop_id
     and original.canonical_category_id=required.category_id
    join public.catalog_category_shop_bindings target
      on target.business_id=v_business
     and target.shop_id=p_target_shop_id
     and target.master_category_id=original.master_category_id
    where exists(
      select 1 from jsonb_array_elements(v_source_categories) category
      where category->>'id'=required.category_id::text
    ) and exists(
      select 1 from jsonb_array_elements(v_target_categories) category
      where category->>'id'=target.canonical_category_id::text
    );
    if v_assignment_categories=0 or
       v_assignment_mapped<>v_assignment_categories
    then return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies'); end if;
    if v_assignment_distinct<>v_assignment_categories then
      return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
    end if;
    v_mapped_category_count:=v_assignment_mapped;
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
          ) else '{}'::jsonb end) ||
        (case when 'productOrder'=any(p_domains) then
          jsonb_build_object('sortOrder',v_mapped->(item.value->>'id')->'sortOrder')
          else '{}'::jsonb end)
        || (case when 'productCategoryAssignments'=any(p_domains) then
          jsonb_build_object('categoryId',
            v_assignment_map->(v_mapped->(item.value->>'id')->>'categoryId'))
          else '{}'::jsonb end)
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
  -- Opt-in combo relation copy uses existing business-master product bindings
  -- for both sides of each option. The target remains the owner of its UUIDs.
  -- Target-only combos survive; published source combos replace only their
  -- mapped target combo's beverage selection, including empty selections.
  if 'comboBeverageOptions'=any(p_domains) then
    v_source_combo_options:=v_source_bundle->'snapshot'->'comboBeverageOptions';
    v_target_combo_options:=v_draft.working_bundle_json->'snapshot'->'comboBeverageOptions';
    if jsonb_typeof(v_source_combo_options)<>'array' or
       jsonb_typeof(v_target_combo_options)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;

    select coalesce(jsonb_object_agg(entry.value->>'id',to_jsonb(entry.key::uuid)),'{}'::jsonb)
      into v_source_to_target_product_map
    from jsonb_each(v_mapped) entry(key,value);
    if (select count(*) from jsonb_object_keys(v_source_to_target_product_map))
       <>v_source_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
    end if;

    select coalesce(jsonb_agg(v_source_to_target_product_map->(p.value->>'id')),'[]'::jsonb)
      into v_affected_target_combos
    from jsonb_array_elements(v_src_products) p(value)
    where p.value->>'isCombo'='true';

    if exists(
      select 1 from jsonb_array_elements(v_source_combo_options) source_option(value)
      where not (v_source_to_target_product_map ? (source_option.value->>'comboProductId'))
         or not (v_source_to_target_product_map ? (source_option.value->>'beverageProductId'))
         or not exists(
           select 1 from jsonb_array_elements(v_src_products) product(value)
           where product.value->>'id'=source_option.value->>'comboProductId'
             and product.value->>'isCombo'='true'
         )
    ) then return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'shopId',p_target_shop_id,
      'comboProductId',v_source_to_target_product_map->(opt.value->>'comboProductId'),
      'beverageProductId',v_source_to_target_product_map->(opt.value->>'beverageProductId'),
      'sortOrder',opt.value->'sortOrder'
    ) order by opt.ordinality),'[]'::jsonb)
      into v_translated_combo_options
    from jsonb_array_elements(v_source_combo_options) with ordinality opt(value,ordinality);
    select coalesce(jsonb_agg(opt.value order by opt.ordinality),'[]'::jsonb)
      into v_preserved_combo_options
    from jsonb_array_elements(v_target_combo_options) with ordinality opt(value,ordinality)
    where not (v_affected_target_combos @> jsonb_build_array(opt.value->'comboProductId'));
    v_result_combo_options:=v_preserved_combo_options||v_translated_combo_options;
    v_mapped_combo_count:=jsonb_array_length(v_translated_combo_options);
    v_bundle:=jsonb_set(v_bundle,'{snapshot,comboBeverageOptions}',v_result_combo_options,false);

    with previous as (
      select opt.value from jsonb_array_elements(v_target_combo_options) opt(value)
      where v_affected_target_combos @> jsonb_build_array(opt.value->'comboProductId')
    ),
    proposed as (
      select opt.value from jsonb_array_elements(v_translated_combo_options) opt(value)
    ),
    changed as (
      select previous.value as before_option, proposed.value as after_option
      from previous full outer join proposed
        on previous.value->>'comboProductId'=proposed.value->>'comboProductId'
       and previous.value->>'beverageProductId'=proposed.value->>'beverageProductId'
      where previous.value is distinct from proposed.value
    )
    select count(*),coalesce(jsonb_agg(jsonb_build_object(
      'targetComboProductId',coalesce(before_option->>'comboProductId',after_option->>'comboProductId'),
      'targetBeverageProductId',coalesce(before_option->>'beverageProductId',after_option->>'beverageProductId'),
      'sortOrderBefore',before_option->'sortOrder',
      'sortOrderAfter',after_option->'sortOrder'
    ) order by coalesce(before_option->>'comboProductId',after_option->>'comboProductId'),
      coalesce(before_option->>'beverageProductId',after_option->>'beverageProductId')),'[]'::jsonb)
      into v_changed_combo_count,v_combo_differences
    from changed;
  end if;

  -- Selected product-modifier links require BOTH the product master mapping
  -- and the standalone product master mapping of each referenced modifier.
  -- No matching by names and no copying of source shop-local modifier UUIDs.
  if 'productModifierLinks'=any(p_domains) then
    v_source_modifier_links:=v_source_bundle->'snapshot'->'productModifierLinks';
    v_target_modifier_links:=v_draft.working_bundle_json->'snapshot'->'productModifierLinks';
    v_source_modifiers:=v_source_bundle->'snapshot'->'modifiers';
    v_target_modifiers:=v_draft.working_bundle_json->'snapshot'->'modifiers';
    if jsonb_typeof(v_source_modifier_links)<>'array' or
       jsonb_typeof(v_target_modifier_links)<>'array' or
       jsonb_typeof(v_source_modifiers)<>'array' or
       jsonb_typeof(v_target_modifiers)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;

    select coalesce(jsonb_object_agg(entry.value->>'id',to_jsonb(entry.key)),'{}'::jsonb)
      into v_source_to_target_product_map
    from jsonb_each(v_mapped) entry(key,value);
    if (select count(*) from jsonb_object_keys(v_source_to_target_product_map))
       <>v_source_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision'); end if;

    select count(*) into v_modifier_ref_count from (
      select distinct link.value->>'modifierId' as modifier_id
      from jsonb_array_elements(v_source_modifier_links) link(value)
    ) referenced;
    select count(*),count(distinct target_modifier.value->>'id'),
      coalesce(jsonb_object_agg(
        source_modifier.value->>'id',to_jsonb(target_modifier.value->>'id')
      ),'{}'::jsonb)
      into v_modifier_mapped_count,v_modifier_distinct_count,v_modifier_map
    from (
      select distinct link.value->>'modifierId' as modifier_id
      from jsonb_array_elements(v_source_modifier_links) link(value)
    ) referenced
    join jsonb_array_elements(v_source_modifiers) source_modifier(value)
      on source_modifier.value->>'id'=referenced.modifier_id
    join jsonb_array_elements(v_target_modifiers) target_modifier(value)
      on target_modifier.value->>'standaloneProductId'
        =v_source_to_target_product_map->>(source_modifier.value->>'standaloneProductId')
    where source_modifier.value->>'standaloneProductId' is not null
      and v_source_to_target_product_map ? (source_modifier.value->>'standaloneProductId');

    if v_modifier_mapped_count<>v_modifier_ref_count or
       exists(select 1 from jsonb_array_elements(v_source_modifier_links) link(value)
         where not (v_source_to_target_product_map ? (link.value->>'productId'))
            or not (v_modifier_map ? (link.value->>'modifierId')))
    then return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
    end if;
    if v_modifier_distinct_count<>v_modifier_ref_count then
      return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
    end if;

    select coalesce(jsonb_agg(to_jsonb(entry.key)),'[]'::jsonb)
      into v_affected_link_products from jsonb_each(v_mapped) entry(key,value);
    select coalesce(jsonb_agg(jsonb_build_object(
      'shopId',p_target_shop_id,
      'productId',v_source_to_target_product_map->(link.value->>'productId'),
      'modifierId',v_modifier_map->(link.value->>'modifierId'),
      'maxQuantity',link.value->'maxQuantity',
      'sortOrder',link.value->'sortOrder'
    ) order by link.ordinality),'[]'::jsonb)
      into v_translated_modifier_links
    from jsonb_array_elements(v_source_modifier_links) with ordinality link(value,ordinality);
    select coalesce(jsonb_agg(link.value order by link.ordinality),'[]'::jsonb)
      into v_preserved_modifier_links
    from jsonb_array_elements(v_target_modifier_links) with ordinality link(value,ordinality)
    where not (v_affected_link_products @> jsonb_build_array(link.value->'productId'));
    v_result_modifier_links:=v_preserved_modifier_links||v_translated_modifier_links;
    v_mapped_modifier_links:=jsonb_array_length(v_translated_modifier_links);
    v_bundle:=jsonb_set(v_bundle,'{snapshot,productModifierLinks}',v_result_modifier_links,false);

    with previous as (
      select link.value from jsonb_array_elements(v_target_modifier_links) link(value)
      where v_affected_link_products @> jsonb_build_array(link.value->'productId')
    ),
    proposed as (
      select link.value from jsonb_array_elements(v_translated_modifier_links) link(value)
    ),
    changed as (
      select previous.value as before_link,proposed.value as after_link
      from previous full outer join proposed
        on previous.value->>'productId'=proposed.value->>'productId'
       and previous.value->>'modifierId'=proposed.value->>'modifierId'
      where previous.value is distinct from proposed.value
    )
    select count(*),coalesce(jsonb_agg(jsonb_build_object(
      'targetProductId',coalesce(before_link->>'productId',after_link->>'productId'),
      'targetModifierId',coalesce(before_link->>'modifierId',after_link->>'modifierId'),
      'maxQuantityBefore',before_link->'maxQuantity',
      'maxQuantityAfter',after_link->'maxQuantity',
      'sortOrderBefore',before_link->'sortOrder',
      'sortOrderAfter',after_link->'sortOrder'
    ) order by coalesce(before_link->>'productId',after_link->>'productId'),
      coalesce(before_link->>'modifierId',after_link->>'modifierId')),'[]'::jsonb)
      into v_changed_modifier_links,v_modifier_link_differences
    from changed;
  end if;

  -- Modifier records remain target-owned. Map a source modifier only through
  -- its standalone product's existing business-master product identity.
  -- Never guess by display name, create new modifiers, or overwrite anchor IDs.
  if 'modifierDefinitions'=any(p_domains) then
    v_source_modifiers:=v_source_bundle->'snapshot'->'modifiers';
    v_target_modifiers:=v_draft.working_bundle_json->'snapshot'->'modifiers';
    if jsonb_typeof(v_source_modifiers)<>'array' or
       jsonb_typeof(v_target_modifiers)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;

    select coalesce(jsonb_object_agg(entry.value->>'id',to_jsonb(entry.key)),'{}'::jsonb)
      into v_source_to_target_product_map
    from jsonb_each(v_mapped) entry(key,value);
    if (select count(*) from jsonb_object_keys(v_source_to_target_product_map))
       <>v_source_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
    end if;

    select count(*) into v_source_modifier_count
    from jsonb_array_elements(v_source_modifiers);
    select count(*),count(distinct target_modifier.value->>'id'),
      coalesce(jsonb_object_agg(target_modifier.value->>'id',source_modifier.value),'{}'::jsonb)
      into v_mapped_modifier_definitions,v_distinct_modifier_definitions,
           v_modifier_definition_map
    from jsonb_array_elements(v_source_modifiers) source_modifier(value)
    join jsonb_array_elements(v_target_modifiers) target_modifier(value)
      on target_modifier.value->>'standaloneProductId'
       = v_source_to_target_product_map->>(source_modifier.value->>'standaloneProductId')
    where source_modifier.value->>'standaloneProductId' is not null
      and v_source_to_target_product_map ? (source_modifier.value->>'standaloneProductId');

    if v_mapped_modifier_definitions<v_source_modifier_count then
      return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
    end if;
    if v_mapped_modifier_definitions>v_source_modifier_count or
       v_distinct_modifier_definitions<>v_source_modifier_count then
      return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision');
    end if;

    select coalesce(jsonb_agg(
      case when v_modifier_definition_map ? (item.value->>'id')
        then item.value||jsonb_build_object(
          'name',v_modifier_definition_map->(item.value->>'id')->'name',
          'priceMinor',v_modifier_definition_map->(item.value->>'id')->'priceMinor',
          'active',v_modifier_definition_map->(item.value->>'id')->'active',
          'sortOrder',v_modifier_definition_map->(item.value->>'id')->'sortOrder'
        )
        else item.value end
      order by item.ordinality),'[]'::jsonb)
      into v_result_modifiers
    from jsonb_array_elements(v_target_modifiers) with ordinality item(value,ordinality);

    -- Current unique(shop_id,name) must remain enforceable even if the
    -- publisher upserts existing rows in an arbitrary order. Refuse both
    -- candidate duplicates and names held by *other* live modifiers.
    if exists(
      select 1 from jsonb_array_elements(v_result_modifiers) item(value)
      group by item.value->>'name' having count(*)>1
    ) or exists(
      select 1 from jsonb_array_elements(v_result_modifiers) item(value)
      join public.modifiers existing on existing.shop_id=p_target_shop_id
        and existing.name=item.value->>'name'
        and existing.id<>(item.value->>'id')::uuid
      where v_modifier_definition_map ? (item.value->>'id')
    ) then
      return jsonb_build_object('ok',false,'code','catalog_copy_target_name_conflict');
    end if;
    v_bundle:=jsonb_set(v_bundle,'{snapshot,modifiers}',v_result_modifiers,false);

    select coalesce(jsonb_agg(jsonb_build_object(
      'targetModifierId',before_item.value->>'id',
      'nameBefore',before_item.value->'name',
      'nameAfter',after_item.value->'name',
      'priceBeforeMinor',before_item.value->'priceMinor',
      'priceAfterMinor',after_item.value->'priceMinor',
      'activeBefore',before_item.value->'active',
      'activeAfter',after_item.value->'active',
      'sortOrderBefore',before_item.value->'sortOrder',
      'sortOrderAfter',after_item.value->'sortOrder'
    ) order by before_item.ordinality),'[]'::jsonb)
      into v_modifier_definition_differences
    from jsonb_array_elements(v_target_modifiers) with ordinality before_item(value,ordinality)
    join jsonb_array_elements(v_result_modifiers) with ordinality after_item(value,ordinality)
      on before_item.ordinality=after_item.ordinality
    where before_item.value is distinct from after_item.value;
    v_changed_modifier_definitions:=jsonb_array_length(v_modifier_definition_differences);
  end if;

  -- Keep inventory UUIDs target-local, not inferred from names.
  -- Exact RECIPE_TRACKED base-unit correspondence is required; target stock,
  -- purchase conversions, and COGS valuations are not copied.
  if 'recipeLines'=any(p_domains) then
    v_source_recipe_lines:=v_source_bundle->'snapshot'->'recipeLines';
    v_target_recipe_lines:=v_draft.working_bundle_json->'snapshot'->'recipeLines';
    v_source_inventory:=v_source_bundle->'inventoryItems';
    v_target_inventory:=v_draft.working_bundle_json->'inventoryItems';
    if jsonb_typeof(v_source_recipe_lines)<>'array' or
       jsonb_typeof(v_target_recipe_lines)<>'array' or
       jsonb_typeof(v_source_inventory)<>'array' or
       jsonb_typeof(v_target_inventory)<>'array'
    then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;
    select coalesce(jsonb_object_agg(entry.value->>'id',to_jsonb(entry.key)),'{}'::jsonb)
      into v_source_to_target_product_map
    from jsonb_each(v_mapped) entry(key,value);
    if (select count(*) from jsonb_object_keys(v_source_to_target_product_map))<>v_source_count
    then return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision'); end if;

    select count(*) into v_required_inventory_count
    from (select distinct (line.value->>'inventoryItemId')::uuid as item_id
          from jsonb_array_elements(v_source_recipe_lines) line(value)) required;
    select count(*),count(distinct target.inventory_item_id),
      coalesce(jsonb_object_agg(required.item_id::text,to_jsonb(target.inventory_item_id)),'{}'::jsonb)
      into v_mapped_inventory_count,v_distinct_inventory_count,v_inventory_item_map
    from (select distinct (line.value->>'inventoryItemId')::uuid as item_id
          from jsonb_array_elements(v_source_recipe_lines) line(value)) required
    join public.catalog_inventory_item_shop_bindings source
      on source.business_id=v_business and source.shop_id=p_source_shop_id
     and source.inventory_item_id=required.item_id
    join public.catalog_inventory_item_shop_bindings target
      on target.business_id=v_business and target.shop_id=p_target_shop_id
     and target.master_inventory_item_id=source.master_inventory_item_id
    where exists(select 1 from jsonb_array_elements(v_source_inventory) src(value)
                 where src.value->>'id'=required.item_id::text)
      and exists(select 1 from jsonb_array_elements(v_target_inventory) dst(value)
                 where dst.value->>'id'=target.inventory_item_id::text);
    if v_required_inventory_count<>v_mapped_inventory_count or exists(
      select 1 from jsonb_array_elements(v_source_recipe_lines) line(value)
      where not (v_source_to_target_product_map ? (line.value->>'productId'))
         or not (v_inventory_item_map ? (line.value->>'inventoryItemId'))
    ) then return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies'); end if;
    if v_distinct_inventory_count<>v_required_inventory_count then
      return jsonb_build_object('ok',false,'code','catalog_copy_target_identity_collision'); end if;

    if exists(
      select 1 from jsonb_array_elements(v_source_recipe_lines) line(value)
      join public.catalog_inventory_item_shop_bindings source
        on source.business_id=v_business and source.shop_id=p_source_shop_id
       and source.inventory_item_id=(line.value->>'inventoryItemId')::uuid
      join public.catalog_inventory_item_shop_bindings target
        on target.business_id=v_business and target.shop_id=p_target_shop_id
       and target.master_inventory_item_id=source.master_inventory_item_id
      join public.catalog_master_inventory_items master
        on master.business_id=v_business and master.id=source.master_inventory_item_id
      join public.inventory_items source_live
        on source_live.shop_id=p_source_shop_id and source_live.id=source.inventory_item_id
      join public.inventory_items target_live
        on target_live.shop_id=p_target_shop_id and target_live.id=target.inventory_item_id
      join jsonb_array_elements(v_source_inventory) original(value)
        on original.value->>'id'=source.inventory_item_id::text
      join jsonb_array_elements(v_target_inventory) destination(value)
        on destination.value->>'id'=target.inventory_item_id::text
      where master.tracking_mode<>'RECIPE_TRACKED'
         or source_live.tracking_mode is distinct from master.tracking_mode
         or target_live.tracking_mode is distinct from master.tracking_mode
         or original.value->>'trackingMode' is distinct from master.tracking_mode
         or destination.value->>'trackingMode' is distinct from master.tracking_mode
         or source_live.unit_label is distinct from master.base_unit_label
         or target_live.unit_label is distinct from master.base_unit_label
         or original.value->>'unitLabel' is distinct from master.base_unit_label
         or destination.value->>'unitLabel' is distinct from master.base_unit_label
         or source_live.active is distinct from true or target_live.active is distinct from true
         or original.value->>'active' is distinct from 'true'
         or destination.value->>'active' is distinct from 'true'
    ) then return jsonb_build_object('ok',false,'code','catalog_copy_incompatible_inventory_units'); end if;

    select coalesce(jsonb_agg(to_jsonb(entry.key)),'[]'::jsonb)
      into v_affected_recipe_products from jsonb_each(v_mapped) entry(key,value);
    select coalesce(jsonb_agg(jsonb_build_object(
      'shopId',p_target_shop_id,
      'productId',v_source_to_target_product_map->(line.value->>'productId'),
      'inventoryItemId',v_inventory_item_map->(line.value->>'inventoryItemId'),
      'quantityMicros',line.value->'quantityMicros'
    ) order by line.ordinality),'[]'::jsonb)
      into v_translated_recipe_lines
    from jsonb_array_elements(v_source_recipe_lines) with ordinality line(value,ordinality);
    select coalesce(jsonb_agg(line.value order by line.ordinality),'[]'::jsonb)
      into v_preserved_recipe_lines
    from jsonb_array_elements(v_target_recipe_lines) with ordinality line(value,ordinality)
    where not (v_affected_recipe_products @> jsonb_build_array(line.value->'productId'));
    v_result_recipe_lines:=v_preserved_recipe_lines||v_translated_recipe_lines;
    v_mapped_recipe_lines:=jsonb_array_length(v_translated_recipe_lines);
    v_bundle:=jsonb_set(v_bundle,'{snapshot,recipeLines}',v_result_recipe_lines,false);

    with previous as (
      select line.value from jsonb_array_elements(v_target_recipe_lines) line(value)
      where v_affected_recipe_products @> jsonb_build_array(line.value->'productId')
    ), proposed as (
      select line.value from jsonb_array_elements(v_translated_recipe_lines) line(value)
    ), changed as (
      select previous.value as before_line,proposed.value as after_line
      from previous full outer join proposed
        on previous.value->>'productId'=proposed.value->>'productId'
       and previous.value->>'inventoryItemId'=proposed.value->>'inventoryItemId'
      where previous.value is distinct from proposed.value
    )
    select count(*),coalesce(jsonb_agg(jsonb_build_object(
      'targetProductId',coalesce(before_line->>'productId',after_line->>'productId'),
      'targetInventoryItemId',coalesce(before_line->>'inventoryItemId',after_line->>'inventoryItemId'),
      'quantityBeforeMicros',before_line->'quantityMicros',
      'quantityAfterMicros',after_line->'quantityMicros'
    ) order by coalesce(before_line->>'productId',after_line->>'productId'),
      coalesce(before_line->>'inventoryItemId',after_line->>'inventoryItemId')),'[]'::jsonb)
      into v_changed_recipe_lines,v_recipe_differences
    from changed;
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
    'sortOrderBefore',old_row.value->'sortOrder',
    'sortOrderAfter',new_row.value->'sortOrder',
    'categoryIdBefore',old_row.value->'categoryId',
    'categoryIdAfter',new_row.value->'categoryId',
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
    'mappedComboBeverageOptions',v_mapped_combo_count,
    'changedComboBeverageOptions',v_changed_combo_count,
    'comboDifferences',v_combo_differences,
    'mappedProductModifierLinks',v_mapped_modifier_links,
    'changedProductModifierLinks',v_changed_modifier_links,
    'productModifierLinkDifferences',v_modifier_link_differences,
    'mappedModifierDefinitions',v_mapped_modifier_definitions,
    'changedModifierDefinitions',v_changed_modifier_definitions,
    'modifierDefinitionDifferences',v_modifier_definition_differences,
    'mappedRecipeLines',v_mapped_recipe_lines,
    'changedRecipeLines',v_changed_recipe_lines,
    'recipeDifferences',v_recipe_differences,
    'fingerprint',v_fingerprint,'candidateBundle',v_bundle
  );
end;
$copy$;





revoke all on function private.build_admin_catalog_copy_existing_products_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[]
) from public,anon,authenticated;
grant execute on function private.build_admin_catalog_copy_existing_products_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[]
) to service_role;

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
  v_request_fingerprint text;
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
  if 'recipeLines'=any(p_domains) then
    perform private.assert_admin_catalog_permission_v1(p_employee_id,p_source_shop_id,'inventory.view');
    perform private.assert_admin_catalog_permission_v1(p_employee_id,p_target_shop_id,'inventory.adjust');
  end if;
  -- Durable identity for the complete original request, not only the
  -- client-supplied preview digest. JSONB text is deterministic.
  v_request_fingerprint:=encode(extensions.digest(
    jsonb_build_object(
      'actorEmployeeId',p_employee_id,'businessId',v_business,
      'sourceShopId',p_source_shop_id,'targetShopId',p_target_shop_id,
      'targetDraftId',p_target_draft_id,
      'sourcePublishVersion',p_source_publish_version,
      'targetPublishVersion',p_target_publish_version,
      'targetDraftRevision',p_target_draft_revision,
      'selectedDomains',to_jsonb(p_domains),
      'previewFingerprint',p_preview_fingerprint
    )::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'tux-admin-catalog-copy:'||v_business::text||':'||p_target_shop_id::text||
    ':'||p_command_id,0
  ));
  select * into v_receipt from public.admin_catalog_copy_receipts
  where business_id=v_business and target_shop_id=p_target_shop_id
    and command_id=p_command_id for update;
  if found then
    if v_receipt.actor_employee_id is distinct from p_employee_id or
       v_receipt.source_shop_id is distinct from p_source_shop_id or
       v_receipt.target_draft_id is distinct from p_target_draft_id or
       v_receipt.preview_fingerprint is distinct from p_preview_fingerprint or
       v_receipt.request_fingerprint is distinct from v_request_fingerprint
    then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
    -- Recheck pricing on a retry: a revoked right cannot use a historical
    -- successful receipt as an authorization oracle.
    if 'productPrices'=any(p_domains) or 'modifierDefinitions'=any(p_domains) then
      perform private.assert_admin_catalog_permission_v1(
        p_employee_id,p_target_shop_id,'catalog.pricing');
    end if;
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
    'mappedComboBeverageOptions',v_plan->'mappedComboBeverageOptions',
    'changedComboBeverageOptions',v_plan->'changedComboBeverageOptions',
    'mappedProductModifierLinks',v_plan->'mappedProductModifierLinks',
    'changedProductModifierLinks',v_plan->'changedProductModifierLinks',
    'mappedModifierDefinitions',v_plan->'mappedModifierDefinitions',
    'changedModifierDefinitions',v_plan->'changedModifierDefinitions',
    'mappedRecipeLines',v_plan->'mappedRecipeLines',
    'changedRecipeLines',v_plan->'changedRecipeLines',
    'publishRequired',true,'fingerprint',p_preview_fingerprint
  );
  insert into public.admin_catalog_copy_receipts(
    business_id,target_shop_id,command_id,source_shop_id,target_draft_id,
    actor_employee_id,preview_fingerprint,request_fingerprint,result_json
  ) values (
    v_business,p_target_shop_id,p_command_id,p_source_shop_id,p_target_draft_id,
    p_employee_id,p_preview_fingerprint,v_request_fingerprint,v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business,p_target_shop_id,p_employee_id,
    'CATALOG_COPY_STAGED','CATALOG_DRAFT',p_target_draft_id::text,
    jsonb_build_object('draftRevision',p_target_draft_revision),
    jsonb_build_object('draftRevision',v_saved->'draftRevision',
      'sourceShopId',p_source_shop_id,'sourcePublishVersion',p_source_publish_version,
      'targetPublishVersion',p_target_publish_version,'domains',to_jsonb(p_domains),
      'mappedProducts',v_plan->'mappedProducts','changedProducts',v_plan->'changedProducts',
      'mappedCategories',v_plan->'mappedCategories','changedCategories',v_plan->'changedCategories',
      'mappedComboBeverageOptions',v_plan->'mappedComboBeverageOptions',
      'changedComboBeverageOptions',v_plan->'changedComboBeverageOptions',
      'mappedProductModifierLinks',v_plan->'mappedProductModifierLinks',
      'changedProductModifierLinks',v_plan->'changedProductModifierLinks',
      'mappedModifierDefinitions',v_plan->'mappedModifierDefinitions',
      'changedModifierDefinitions',v_plan->'changedModifierDefinitions',
      'mappedRecipeLines',v_plan->'mappedRecipeLines',
      'changedRecipeLines',v_plan->'changedRecipeLines'),
    'Selective master-mapped product configuration copy',
    null,null,jsonb_build_object('commandId',p_command_id,'fingerprint',p_preview_fingerprint)
  );
  return v_result;
end;
$apply$;

revoke all on function public.apply_admin_catalog_shop_copy_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[],text,text
) from public,anon,authenticated;
grant execute on function public.apply_admin_catalog_shop_copy_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,bigint,text[],text,text
) to service_role;

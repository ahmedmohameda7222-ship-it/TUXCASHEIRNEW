-- PR #119 / Plan 2: new Products with trusted inventory-master mapped
-- recipe dependency in the same target Draft Stage transaction.
-- Existing publish path atomically materializes recipe lines and binds the
-- original Product master. Never mutate stock balances, movements or COGS.
-- Preserve the pre-existing fail-closed guard for modifier/combo dependencies.
create or replace function public.stage_admin_catalog_copy_created_entities_v1(
 p_employee_id uuid,p_source_shop_id uuid,p_target_shop_id uuid,
 p_target_draft_id uuid,p_source_publish_version bigint,
 p_target_publish_version bigint,p_target_draft_revision bigint,
 p_source_category_ids uuid[],p_source_product_ids uuid[],
 p_creation_fingerprint text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $stage$
declare
 v_draft public.catalog_drafts%rowtype;
 v_business uuid;
 v_target_business uuid;
 v_receipt public.admin_catalog_copy_receipts%rowtype;
 v_preview jsonb;
 v_source_bundle jsonb;
 v_new_categories jsonb:='[]'::jsonb;
 v_new_products jsonb:='[]'::jsonb;
 v_intents jsonb:='[]'::jsonb;
 v_bundle jsonb;
 v_saved jsonb;
 v_result jsonb;
 v_req_hash text;
 v_src_id uuid;
 v_src jsonb;
 v_mapping jsonb;
 v_local uuid;
 v_target_category uuid;
 v_shops uuid;
 v_cat jsonb;
 v_recipe record;
 v_new_recipe_lines jsonb:='[]'::jsonb;
 v_target_inventory_id uuid;
 v_master_unit text;
 v_master_mode text;
 v_source_unit text;
 v_target_unit text;
 v_source_mode text;
 v_target_mode text;
 v_source_active boolean;
 v_target_active boolean;
 v_source_json jsonb;
 v_target_json jsonb;
begin
 if p_employee_id is null or p_source_shop_id is null or
    p_target_shop_id is null or p_target_draft_id is null or
    p_source_shop_id=p_target_shop_id or
    p_source_publish_version is null or p_source_publish_version<=0 or
    p_target_publish_version is null or p_target_publish_version<0 or
    p_target_draft_revision is null or p_target_draft_revision<=0 or
    p_source_category_ids is null or p_source_product_ids is null or
    cardinality(p_source_category_ids)+cardinality(p_source_product_ids)=0 or
    cardinality(p_source_category_ids)>100 or cardinality(p_source_product_ids)>200 or
    p_creation_fingerprint !~ '^[0-9a-f]{64}$' or
    p_command_id is null or length(btrim(p_command_id)) not between 1 and 128
 then return jsonb_build_object('ok',false,'code','invalid_catalog_copy_request'); end if;
 if exists(select 1 from unnest(p_source_category_ids||p_source_product_ids) x
           where x is null)
    or (select count(distinct x) from unnest(p_source_category_ids) x)
       <>cardinality(p_source_category_ids)
    or (select count(distinct x) from unnest(p_source_product_ids) x)
       <>cardinality(p_source_product_ids)
 then return jsonb_build_object('ok',false,'code','invalid_catalog_copy_selection'); end if;

 select * into v_draft from public.catalog_drafts
 where id=p_target_draft_id for update;
 if not found or v_draft.shop_id is distinct from p_target_shop_id then
   return jsonb_build_object('ok',false,'code','catalog_copy_target_draft_invalid'); end if;
 v_business:=private.assert_admin_catalog_permission_v1(
   p_employee_id,p_source_shop_id,'catalog.view');
 v_target_business:=private.assert_admin_catalog_permission_v1(
   p_employee_id,p_target_shop_id,'catalog.edit');
 if v_business is distinct from v_target_business or
    v_draft.business_id is distinct from v_business
 then return jsonb_build_object('ok',false,'code','cross_business_copy_forbidden'); end if;
 if cardinality(p_source_product_ids)>0 then
   perform private.assert_admin_catalog_permission_v1(
     p_employee_id,p_target_shop_id,'catalog.pricing');
 end if;
 v_req_hash:=encode(sha256(convert_to(jsonb_build_object(
   'actor',p_employee_id,'source',p_source_shop_id,
   'target',p_target_shop_id,'draft',p_target_draft_id,
   'sourceVersion',p_source_publish_version,'targetVersion',p_target_publish_version,
   'draftRevision',p_target_draft_revision,'categories',p_source_category_ids,
   'products',p_source_product_ids,'preview',p_creation_fingerprint
 )::text,'UTF8')),'hex');

 select * into v_receipt from public.admin_catalog_copy_receipts
 where target_shop_id=p_target_shop_id and command_id=p_command_id;
 if found then
   if v_receipt.business_id<>v_business or
      v_receipt.actor_employee_id<>p_employee_id or
      v_receipt.source_shop_id<>p_source_shop_id or
      v_receipt.target_draft_id<>p_target_draft_id or
      v_receipt.preview_fingerprint<>p_creation_fingerprint or
      v_receipt.request_fingerprint is distinct from v_req_hash
   then return jsonb_build_object('ok',false,'code','command_id_conflict'); end if;
   if coalesce((v_receipt.result_json->>'createdRecipeLines')::bigint,0)>0 then
     perform private.assert_admin_catalog_permission_v1(
       p_employee_id,p_source_shop_id,'inventory.view');
     perform private.assert_admin_catalog_permission_v1(
       p_employee_id,p_target_shop_id,'inventory.adjust');
   end if;
   return v_receipt.result_json||jsonb_build_object('replayed',true);
 end if;
 if v_draft.status<>'DRAFT' or v_draft.draft_revision<>p_target_draft_revision
    or v_draft.base_publish_version<>p_target_publish_version
 then return jsonb_build_object('ok',false,'code','stale_draft_revision'); end if;
 for v_shops in
   select id from (select p_source_shop_id id union select p_target_shop_id id) s
   order by id
 loop perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-catalog:'||v_shops::text,0)); end loop;
 v_preview:=public.preview_admin_catalog_missing_entities_v1(
   p_employee_id,p_source_shop_id,p_target_shop_id,p_target_draft_id,
   p_source_publish_version,p_target_publish_version,p_target_draft_revision);
 if v_preview->>'ok' is distinct from 'true' then return v_preview; end if;
 if v_preview->>'creationFingerprint' is distinct from p_creation_fingerprint then
   return jsonb_build_object('ok',false,'code','stale_catalog_copy_preview'); end if;
 select bundle_json into v_source_bundle from public.catalog_publish_versions
 where shop_id=p_source_shop_id and business_id=v_business
   and publish_version=p_source_publish_version;
 if not found then
   return jsonb_build_object('ok',false,'code','stale_catalog_copy_preview'); end if;
 foreach v_src_id in array p_source_category_ids loop
   select x.value into v_mapping
   from jsonb_array_elements(v_preview->'categories') x(value)
   where x.value->>'sourceCategoryId'=v_src_id::text;
   if not found or v_mapping->>'status'<>'CREATE_REQUIRED' or
      v_mapping->>'proposedTargetCategoryId' is null then
     return jsonb_build_object('ok',false,'code','catalog_copy_creation_conflict'); end if;
   select x.value into v_src from jsonb_array_elements(
     v_source_bundle->'snapshot'->'categories') x(value)
   where x.value->>'id'=v_src_id::text;
   if not found then
     return jsonb_build_object('ok',false,'code','catalog_copy_creation_conflict'); end if;
   v_local:=(v_mapping->>'proposedTargetCategoryId')::uuid;
   v_cat:=jsonb_set(jsonb_set(v_src,'{id}',to_jsonb(v_local::text)),
                        '{shopId}',to_jsonb(p_target_shop_id::text));
   v_new_categories:=v_new_categories||jsonb_build_array(v_cat);
   v_intents:=v_intents||jsonb_build_array(jsonb_build_object(
     'kind','category','sourceId',v_src_id,
     'masterId',v_mapping->>'masterCategoryId','targetId',v_local));
 end loop;
 foreach v_src_id in array p_source_product_ids loop
   select x.value into v_mapping from jsonb_array_elements(v_preview->'products') x(value)
   where x.value->>'sourceProductId'=v_src_id::text;
   if not found or v_mapping->>'status' not in
      ('CREATE_REQUIRED','MISSING_TARGET_CATEGORY') or
      v_mapping->>'proposedTargetProductId' is null then
     return jsonb_build_object('ok',false,'code','catalog_copy_creation_conflict'); end if;
   select x.value into v_src from jsonb_array_elements(
     v_source_bundle->'snapshot'->'products') x(value)
   where x.value->>'id'=v_src_id::text;
   if not found then
     return jsonb_build_object('ok',false,'code','catalog_copy_creation_conflict'); end if;
   v_target_category:=(v_mapping->>'proposedTargetCategoryId')::uuid;
   if not exists(
      select 1 from jsonb_array_elements(
        (v_draft.working_bundle_json->'snapshot'->'categories')||v_new_categories
      ) c(value) where c.value->>'id'=v_target_category::text
   ) then
      return jsonb_build_object('ok',false,'code','catalog_copy_missing_target_dependencies');
   end if;
   -- Scope guard: modifiers, combo links and recipes require additional
   -- explicit mapping; never silently discard source product dependencies.
   if exists(select 1 from jsonb_array_elements(
      v_source_bundle->'snapshot'->'productModifierLinks') x(value)
      where x.value->>'productId'=v_src_id::text)
      or exists(select 1 from jsonb_array_elements(
      v_source_bundle->'snapshot'->'comboBeverageOptions') x(value)
      where x.value->>'comboProductId'=v_src_id::text
         or x.value->>'beverageProductId'=v_src_id::text)
      or exists(select 1 from jsonb_array_elements(
      v_source_bundle->'snapshot'->'modifiers') x(value)
      where x.value->>'standaloneProductId'=v_src_id::text)
   then return jsonb_build_object('ok',false,
     'code','catalog_copy_unresolved_entity_dependencies'); end if;
   v_local:=(v_mapping->>'proposedTargetProductId')::uuid;
   v_cat:=jsonb_set(jsonb_set(jsonb_set(
     v_src,'{id}',to_jsonb(v_local::text)),
     '{shopId}',to_jsonb(p_target_shop_id::text)),
     '{categoryId}',to_jsonb(v_target_category::text));
   -- Recipes are copied only with explicit same-business inventory
   -- master mappings. No name fallback, source-local ID reuse, stock balance,
   -- ledger, item creation, cost or COGS copying.
   for v_recipe in
     select line.value from jsonb_array_elements(
       v_source_bundle->'snapshot'->'recipeLines') line(value)
     where line.value->>'productId'=v_src_id::text
   loop
     perform private.assert_admin_catalog_permission_v1(
       p_employee_id,p_source_shop_id,'inventory.view');
     perform private.assert_admin_catalog_permission_v1(
       p_employee_id,p_target_shop_id,'inventory.adjust');
     if jsonb_typeof(v_source_bundle->'inventoryItems')<>'array'
        or jsonb_typeof(v_draft.working_bundle_json->'inventoryItems')<>'array'
     then return jsonb_build_object('ok',false,'code','catalog_copy_bundle_invalid'); end if;
     v_target_inventory_id:=null;
     select dst.inventory_item_id,master.base_unit_label,master.tracking_mode,
            src_live.unit_label,dst_live.unit_label,
            src_live.tracking_mode,dst_live.tracking_mode,
            src_live.active,dst_live.active
       into v_target_inventory_id,v_master_unit,v_master_mode,
            v_source_unit,v_target_unit,v_source_mode,v_target_mode,
            v_source_active,v_target_active
     from public.catalog_inventory_item_shop_bindings src
     join public.catalog_inventory_item_shop_bindings dst
       on dst.business_id=src.business_id
      and dst.master_inventory_item_id=src.master_inventory_item_id
      and dst.shop_id=p_target_shop_id
     join public.catalog_master_inventory_items master
       on master.business_id=src.business_id
      and master.id=src.master_inventory_item_id
     join public.inventory_items src_live
       on src_live.id=src.inventory_item_id and src_live.shop_id=p_source_shop_id
     join public.inventory_items dst_live
       on dst_live.id=dst.inventory_item_id and dst_live.shop_id=p_target_shop_id
     where src.business_id=v_business and src.shop_id=p_source_shop_id
       and src.inventory_item_id=(v_recipe.value->>'inventoryItemId')::uuid;
     if v_target_inventory_id is null then
       return jsonb_build_object('ok',false,
         'code','catalog_copy_missing_target_dependencies');
     end if;
     select item.value into v_source_json
       from jsonb_array_elements(v_source_bundle->'inventoryItems') item(value)
       where item.value->>'id'=v_recipe.value->>'inventoryItemId';
     select item.value into v_target_json
       from jsonb_array_elements(v_draft.working_bundle_json->'inventoryItems') item(value)
       where item.value->>'id'=v_target_inventory_id::text;
     if v_source_json is null or v_target_json is null then
       return jsonb_build_object('ok',false,
         'code','catalog_copy_missing_target_dependencies');
     end if;
     if v_master_mode<>'RECIPE_TRACKED'
        or v_source_mode is distinct from v_master_mode
        or v_target_mode is distinct from v_master_mode
        or v_source_unit is distinct from v_master_unit
        or v_target_unit is distinct from v_master_unit
        or v_source_active is distinct from true
        or v_target_active is distinct from true
        or v_source_json->>'unitLabel' is distinct from v_master_unit
        or v_target_json->>'unitLabel' is distinct from v_master_unit
        or v_source_json->>'trackingMode' is distinct from v_master_mode
        or v_target_json->>'trackingMode' is distinct from v_master_mode
        or v_source_json->>'active' is distinct from 'true'
        or v_target_json->>'active' is distinct from 'true'
     then return jsonb_build_object('ok',false,
       'code','catalog_copy_incompatible_inventory_units');
     end if;
     v_new_recipe_lines:=v_new_recipe_lines||jsonb_build_array(jsonb_build_object(
       'shopId',p_target_shop_id,
       'productId',v_local,
       'inventoryItemId',v_target_inventory_id,
       'quantityMicros',v_recipe.value->'quantityMicros'
     ));
   end loop;
   v_new_products:=v_new_products||jsonb_build_array(v_cat);
   v_intents:=v_intents||jsonb_build_array(jsonb_build_object(
     'kind','product','sourceId',v_src_id,
     'masterId',v_mapping->>'masterProductId',
     'masterCategoryId',v_mapping->>'masterCategoryId','targetId',v_local));
 end loop;
 v_bundle:=jsonb_set(jsonb_set(v_draft.working_bundle_json,
  '{snapshot,categories}',
  (v_draft.working_bundle_json->'snapshot'->'categories')||v_new_categories),
  '{snapshot,products}',
  (v_draft.working_bundle_json->'snapshot'->'products')||v_new_products);
 v_bundle:=jsonb_set(v_bundle,'{snapshot,recipeLines}',
   (v_draft.working_bundle_json->'snapshot'->'recipeLines')||v_new_recipe_lines);
 -- Existing target data is preserved. A selected new entity may never
 -- collide by normalized name with ANY other target-local entity, including
 -- another newly selected source master with a different UUID.
 if exists (
   select 1 from jsonb_array_elements(v_new_categories) created(value)
   join jsonb_array_elements(v_bundle->'snapshot'->'categories') other(value)
     on created.value->>'id' is distinct from other.value->>'id'
    and lower(btrim(created.value->>'name'))=lower(btrim(other.value->>'name'))
 ) or exists (
   select 1 from jsonb_array_elements(v_new_products) created(value)
   join jsonb_array_elements(v_bundle->'snapshot'->'products') other(value)
     on created.value->>'id' is distinct from other.value->>'id'
    and lower(btrim(created.value->>'name'))=lower(btrim(other.value->>'name'))
 ) then
   return jsonb_build_object('ok',false,'code','catalog_copy_target_name_conflict');
 end if;
 perform private.validate_admin_catalog_bundle_v1(p_target_shop_id,v_bundle);
 v_saved:=public.apply_catalog_draft_change_v1(
   p_employee_id,p_target_draft_id,p_target_draft_revision,
   jsonb_build_object('bundleJson',v_bundle));
 if v_saved->>'ok' is distinct from 'true' then return v_saved; end if;

 insert into private.admin_catalog_copy_creation_intents(
   business_id,target_shop_id,target_draft_id,source_shop_id,
   source_publish_version,entity_kind,source_master_id,source_local_id,
   target_local_id,source_master_category_id,command_id)
 select v_business,p_target_shop_id,p_target_draft_id,p_source_shop_id,
   p_source_publish_version,i.value->>'kind',
   (i.value->>'masterId')::uuid,(i.value->>'sourceId')::uuid,
   (i.value->>'targetId')::uuid,
   nullif(i.value->>'masterCategoryId','')::uuid,p_command_id
 from jsonb_array_elements(v_intents) i(value);

 v_result:=jsonb_build_object('ok',true,'replayed',false,
    'targetDraftId',p_target_draft_id,
    'draftRevision',v_saved->'draftRevision',
    'createdCategories',jsonb_array_length(v_new_categories),
    'createdProducts',jsonb_array_length(v_new_products),
    'createdRecipeLines',jsonb_array_length(v_new_recipe_lines),
    'createdCategoryIds',(select coalesce(jsonb_agg(
       (c.value->>'id')::uuid order by c.ordinality),'[]'::jsonb)
       from jsonb_array_elements(v_new_categories) with ordinality c(value,ordinality)),
    'createdProductIds',(select coalesce(jsonb_agg(
       (p.value->>'id')::uuid order by p.ordinality),'[]'::jsonb)
       from jsonb_array_elements(v_new_products) with ordinality p(value,ordinality)),
    'publishRequired',true,'creationFingerprint',p_creation_fingerprint);
 insert into public.admin_catalog_copy_receipts(
   business_id,target_shop_id,command_id,source_shop_id,
   target_draft_id,actor_employee_id,preview_fingerprint,
   request_fingerprint,result_json
 ) values (
   v_business,p_target_shop_id,p_command_id,p_source_shop_id,
   p_target_draft_id,p_employee_id,p_creation_fingerprint,v_req_hash,v_result);
 perform public.append_admin_audit_event_v1(
   v_business,p_target_shop_id,p_employee_id,
   'CATALOG_COPY_STAGED','CATALOG_DRAFT',p_target_draft_id::text,
   jsonb_build_object('draftRevision',p_target_draft_revision),
   jsonb_build_object('draftRevision',v_saved->'draftRevision',
     'sourceShopId',p_source_shop_id,'sourcePublishVersion',p_source_publish_version,
     'createdCategoryIds',v_result->'createdCategoryIds',
     'createdProductIds',v_result->'createdProductIds'),
   'Explicit new Catalog entity creation staged (not published)',
   null,null,jsonb_build_object('commandId',p_command_id,
     'fingerprint',p_creation_fingerprint));
 return v_result;
end;
$stage$;

revoke all on function public.stage_admin_catalog_copy_created_entities_v1(
 uuid,uuid,uuid,uuid,bigint,bigint,bigint,uuid[],uuid[],text,text
) from public,anon,authenticated;
grant execute on function public.stage_admin_catalog_copy_created_entities_v1(
 uuid,uuid,uuid,uuid,bigint,bigint,bigint,uuid[],uuid[],text,text
) to service_role;

-- PR #119 / Approved Plan 2. Source-mapped Category/Product entity creation.
-- Nothing materializes before the existing canonical Draft Publish.
-- Pending intents are business/shop/draft-scoped and invisible to public roles.
create table private.admin_catalog_copy_creation_intents (
 business_id uuid not null,
 target_shop_id uuid not null,
 target_draft_id uuid not null,
 source_shop_id uuid not null,
 source_publish_version bigint not null check(source_publish_version>0),
 entity_kind text not null check(entity_kind in ('category','product')),
 source_master_id uuid not null,
 source_local_id uuid not null,
 target_local_id uuid not null,
 source_master_category_id uuid,
 command_id text not null check(length(command_id) between 1 and 128),
 created_at timestamptz not null default now(),
 primary key(target_draft_id,entity_kind,source_master_id),
 unique(target_draft_id,entity_kind,target_local_id),
 foreign key (business_id,target_draft_id)
   references public.catalog_drafts(business_id,id) on delete restrict,
 foreign key (business_id,target_shop_id)
   references public.business_shops(business_id,shop_id) on delete restrict,
 foreign key (business_id,source_shop_id)
   references public.business_shops(business_id,shop_id) on delete restrict,
 check (target_shop_id <> source_shop_id)
);
create index admin_catalog_creation_intents_target_idx
 on private.admin_catalog_copy_creation_intents(target_shop_id,target_draft_id);
alter table private.admin_catalog_copy_creation_intents enable row level security;
revoke all on private.admin_catalog_copy_creation_intents from public,anon,authenticated,service_role;

-- Bind existing business-master identities only after the canonical publisher
-- materializes matching target-local IDs. Exception aborts the whole publish.
create or replace function private.bind_admin_catalog_copy_creation_intents_v1(
 p_business_id uuid, p_target_shop_id uuid,p_draft_id uuid,p_bundle jsonb
) returns void language plpgsql security definer
set search_path=pg_catalog,public,private
as $binder$
declare
 v_expected_categories bigint;
 v_expected_products bigint;
 v_count bigint;
 v_source record;
begin
 if not exists(select 1 from private.admin_catalog_copy_creation_intents
               where target_draft_id=p_draft_id) then return; end if;
 if not exists(
   select 1 from public.catalog_drafts d
   where d.id=p_draft_id and d.shop_id=p_target_shop_id
     and d.business_id=p_business_id and d.status='DRAFT'
 ) then raise exception 'TUX_CATALOG_COPY_TARGET_DRAFT_INVALID'; end if;
 for v_source in select distinct source_shop_id,source_publish_version
                 from private.admin_catalog_copy_creation_intents
                 where target_draft_id=p_draft_id
 loop
   if (select coalesce(max(v.publish_version),0)
       from public.catalog_publish_versions v
       where v.shop_id=v_source.source_shop_id and v.business_id=p_business_id)
       <>v_source.source_publish_version
   then raise exception 'TUX_CATALOG_COPY_SOURCE_PUBLICATION_STALE'; end if;
 end loop;
 select count(*) into v_expected_categories
 from private.admin_catalog_copy_creation_intents
 where target_draft_id=p_draft_id and entity_kind='category';
 select count(*) into v_expected_products
 from private.admin_catalog_copy_creation_intents
 where target_draft_id=p_draft_id and entity_kind='product';

 insert into public.catalog_category_shop_bindings(
   business_id,master_category_id,shop_id,canonical_category_id
 )
 select i.business_id,i.source_master_id,i.target_shop_id,i.target_local_id
 from private.admin_catalog_copy_creation_intents i
 join public.catalog_master_categories mc
   on mc.id=i.source_master_id and mc.business_id=i.business_id
 join public.catalog_category_shop_bindings source_link
   on source_link.business_id=i.business_id
  and source_link.shop_id=i.source_shop_id
  and source_link.master_category_id=i.source_master_id
  and source_link.canonical_category_id=i.source_local_id
 join public.menu_categories c on c.shop_id=i.target_shop_id and c.id=i.target_local_id
 where i.target_draft_id=p_draft_id and i.entity_kind='category'
   and i.business_id=p_business_id and i.target_shop_id=p_target_shop_id
   and exists(
     select 1 from jsonb_to_recordset(p_bundle->'snapshot'->'categories') as item(id uuid)
     where item.id=i.target_local_id
   );
 get diagnostics v_count=row_count;
 if v_count<>v_expected_categories then
   raise exception 'TUX_CATALOG_COPY_CATEGORY_INTENT_INCOMPLETE'; end if;

 insert into public.catalog_product_shop_overrides(
   business_id,master_product_id,shop_id,canonical_product_id,
   price_minor,visible,manual_sold_out,version
 )
 select i.business_id,i.source_master_id,i.target_shop_id,i.target_local_id,
        p.price_minor,p.active,p.sold_out,1
 from private.admin_catalog_copy_creation_intents i
 join public.catalog_master_products mp
   on mp.id=i.source_master_id and mp.business_id=i.business_id
  and mp.master_category_id=i.source_master_category_id
 join public.catalog_product_shop_overrides source_link
   on source_link.business_id=i.business_id
  and source_link.shop_id=i.source_shop_id
  and source_link.master_product_id=i.source_master_id
  and source_link.canonical_product_id=i.source_local_id
 join public.products p on p.shop_id=i.target_shop_id and p.id=i.target_local_id
 join public.catalog_category_shop_bindings target_cat
   on target_cat.business_id=i.business_id
  and target_cat.shop_id=i.target_shop_id
  and target_cat.master_category_id=mp.master_category_id
  and target_cat.canonical_category_id=p.category_id
 where i.target_draft_id=p_draft_id and i.entity_kind='product'
   and i.business_id=p_business_id and i.target_shop_id=p_target_shop_id
   and exists(
     select 1 from jsonb_to_recordset(p_bundle->'snapshot'->'products') as item(
       id uuid,"categoryId" uuid
     ) where item.id=i.target_local_id and item."categoryId"=p.category_id
   );
 get diagnostics v_count=row_count;
 if v_count<>v_expected_products then
   raise exception 'TUX_CATALOG_COPY_PRODUCT_INTENT_INCOMPLETE'; end if;
end;
$binder$;
revoke all on function private.bind_admin_catalog_copy_creation_intents_v1(uuid,uuid,uuid,jsonb)
 from public,anon,authenticated,service_role;

-- Approved source publication + explicit selected source UUIDs -> validated
-- target Draft candidate. Never writes live Categories, Products or masters.
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
      v_source_bundle->'snapshot'->'recipeLines') x(value)
      where x.value->>'productId'=v_src_id::text)
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

-- Preserve all existing protected canonical publisher behavior. New draft
-- creation intents are bound AFTER canonical rows materialize and BEFORE the
-- original master sync can accidentally allocate unrelated masters.
CREATE OR REPLACE FUNCTION private.publish_admin_catalog_draft_authorized_v1(p_employee_id uuid, p_draft_id uuid, p_expected_draft_revision bigint, p_expected_base_publish_version bigint, p_require_current_employee_authority boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
  v_lock_shop uuid;
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

  -- Lock source and target shop publication authority in stable UUID order.
  -- Unrelated drafts continue to take the same single-shop lock as before.
  for v_lock_shop in
    select shop_id from (
      select v_draft.shop_id as shop_id
      union
      select i.source_shop_id from private.admin_catalog_copy_creation_intents i
      where i.target_draft_id=v_draft.id
    ) shops order by shop_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('tux-admin-catalog:' || v_lock_shop::text, 0));
  end loop;

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
  perform private.bind_admin_catalog_copy_creation_intents_v1(
    v_draft.business_id,v_draft.shop_id,v_draft.id,v_bundle
  );
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
$function$


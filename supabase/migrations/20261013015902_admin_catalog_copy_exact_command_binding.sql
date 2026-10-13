-- Plans 1-7 Correction A: bind durable Catalog Copy receipts to the
-- authorized actor and every request field. No draft, product or historical
-- operational row is modified; existing legacy receipts without a full
-- binding fail closed rather than being silently replayed.
alter table public.admin_catalog_copy_receipts
  add column if not exists request_fingerprint text;

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
    if 'productPrices'=any(p_domains) then
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
      'mappedCategories',v_plan->'mappedCategories','changedCategories',v_plan->'changedCategories'),
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

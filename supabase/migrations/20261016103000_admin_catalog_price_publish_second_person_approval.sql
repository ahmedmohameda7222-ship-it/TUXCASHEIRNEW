-- Plans 2/3 price approval: canonical draft release guard shared by
-- direct and scheduled execution, shop-scoped threshold preview, immutable
-- exactly-once worker receipts, and fail-closed high-risk restore/scheduling.
-- No live catalog changes or operational DML in this migration.
create table if not exists private.admin_catalog_price_publish_approval_receipts (
 approval_request_id uuid primary key references public.admin_approval_requests(id),
 business_id uuid not null,shop_id uuid not null,draft_id uuid not null,
 approval_command_id uuid not null,
 expected_draft_revision bigint not null,
 expected_publish_version bigint not null,
 max_price_delta_minor bigint not null,
 candidate_fingerprint text not null,
 result_json jsonb not null,
 created_at timestamptz not null default now(),
 unique (business_id,shop_id,approval_command_id)
);
alter table private.admin_catalog_price_publish_approval_receipts enable row level security;
revoke all on private.admin_catalog_price_publish_approval_receipts
 from public,anon,authenticated,service_role;

-- Price impact is computed against current materialized catalog rows,
-- including new product/modifier prices. The caller cannot submit a threshold amount.
create or replace function private.admin_catalog_price_max_delta_v1(
  p_shop_id uuid,p_bundle jsonb
) returns bigint
language sql stable security definer set search_path=pg_catalog,public,private
as $price_delta$
  select greatest(
    coalesce((
      select max(abs(coalesce(candidate."priceMinor",0)-coalesce(current_row.price_minor,0)))
      from jsonb_to_recordset(coalesce(p_bundle #> '{snapshot,products}','[]'::jsonb))
        as candidate(id uuid,"priceMinor" bigint)
      left join public.products current_row
        on current_row.id=candidate.id and current_row.shop_id=p_shop_id
    ),0),
    coalesce((
      select max(abs(coalesce(candidate."priceMinor",0)-coalesce(current_row.price_minor,0)))
      from jsonb_to_recordset(coalesce(p_bundle #> '{snapshot,modifiers}','[]'::jsonb))
        as candidate(id uuid,"priceMinor" bigint)
      left join public.modifiers current_row
        on current_row.id=candidate.id and current_row.shop_id=p_shop_id
    ),0)
  );
$price_delta$;

-- One shop-specific active policy beats business-wide fallback. Absence of
-- thresholdContext.minimumMinor means approve any positive price impact.
create or replace function private.admin_catalog_price_requires_approval_v1(
  p_business_id uuid,p_shop_id uuid,p_max_delta_minor bigint
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public,private
as $price_rule$
declare
  v_rule public.admin_approval_rules%rowtype;
  v_minimum bigint;
begin
  if p_max_delta_minor is null or p_max_delta_minor<=0 then return false; end if;
  select * into v_rule
  from public.admin_approval_rules r
  where r.business_id=p_business_id
    and r.action_type='CATALOG_PRICE_PUBLISH'
    and r.active and (r.shop_id=p_shop_id or r.shop_id is null)
  order by case when r.shop_id=p_shop_id then 0 else 1 end
  limit 1;
  if not found then return false; end if;
  v_minimum:=coalesce((v_rule.threshold_context->>'minimumMinor')::bigint,0);
  if v_minimum<0 then
    raise exception 'TUX_ADMIN_CATALOG_PRICE_APPROVAL_INVALID_THRESHOLD';
  end if;
  return p_max_delta_minor>=v_minimum;
end;
$price_rule$;

create or replace function public.preview_admin_catalog_price_publish_v1(
  p_employee_id uuid,p_draft_id uuid,p_expected_draft_revision bigint,
  p_expected_publish_version bigint
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $price_preview$
declare
  v_draft public.catalog_drafts%rowtype;
  v_business_id uuid;
  v_current_version bigint;
  v_current_operations integer;
  v_bundle jsonb;
  v_impact bigint;
begin
  if p_employee_id is null or p_draft_id is null
    or p_expected_draft_revision is null or p_expected_draft_revision<1
    or p_expected_publish_version is null or p_expected_publish_version<0 then
    return jsonb_build_object('ok',false,'code','invalid_catalog_price_preview');
  end if;
  select * into v_draft from public.catalog_drafts
    where id=p_draft_id for update;
  if not found then return jsonb_build_object('ok',false,'code','draft_not_found'); end if;
  if v_draft.status<>'DRAFT' then
    return jsonb_build_object('ok',false,'code','draft_not_publishable');
  end if;
  v_business_id:=private.assert_admin_catalog_permission_v1(
    p_employee_id,v_draft.shop_id,'catalog.publish');
  if v_business_id is distinct from v_draft.business_id then
    return jsonb_build_object('ok',false,'code','catalog_business_mismatch');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-catalog:'||v_draft.shop_id::text,0));
  if v_draft.draft_revision<>p_expected_draft_revision then
    return jsonb_build_object('ok',false,'code','stale_draft_revision',
      'currentDraftRevision',v_draft.draft_revision);
  end if;
  select coalesce(max(v.publish_version),0) into v_current_version
    from public.catalog_publish_versions v where v.shop_id=v_draft.shop_id;
  if v_current_version<>p_expected_publish_version
    or v_draft.base_publish_version<>v_current_version then
    return jsonb_build_object('ok',false,'code','stale_version',
      'currentVersion',v_current_version);
  end if;
  select coalesce(max(v.version),0) into v_current_operations
    from public.operations_configuration_snapshots v
    where v.shop_id=v_draft.shop_id;
  v_bundle:=private.merge_catalog_owned_draft_bundle_v1(
    v_draft.shop_id,v_draft.working_bundle_json,v_current_operations,now());
  v_impact:=private.admin_catalog_price_max_delta_v1(v_draft.shop_id,v_bundle);
  if v_impact>0 then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id,v_draft.shop_id,'catalog.pricing');
  end if;
  return jsonb_build_object('ok',true,'shopId',v_draft.shop_id,
    'maxPriceDeltaMinor',v_impact,'candidateFingerprint',md5(v_draft.working_bundle_json::text));
end;
$price_preview$;

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
  v_price_impact bigint;
  v_price_fingerprint text;
  v_price_approved boolean;
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

  v_price_impact:=private.admin_catalog_price_max_delta_v1(
    v_draft.shop_id,v_bundle);
  v_price_fingerprint:=md5(v_draft.working_bundle_json::text);
  v_price_approved:=exists (
    select 1 from public.admin_approval_requests a
    where a.id=nullif(
      current_setting('tux.approved_catalog_price_request_id',true),''
    )::uuid
      and a.business_id=v_draft.business_id and a.shop_id=v_draft.shop_id
      and a.action_type='CATALOG_PRICE_PUBLISH'
      and a.requester_employee_id=p_employee_id
      and a.approver_employee_id is not null
      and a.approver_employee_id<>p_employee_id
      and a.status='EXECUTING'
      and a.command_payload=jsonb_build_object(
        'shopId',v_draft.shop_id,
        'draftId',v_draft.id,
        'expectedDraftRevision',p_expected_draft_revision,
        'expectedVersion',p_expected_base_publish_version,
        'maxPriceDeltaMinor',v_price_impact,
        'candidateFingerprint',v_price_fingerprint)
  );
  if (
    private.admin_catalog_price_requires_approval_v1(
      v_draft.business_id,v_draft.shop_id,v_price_impact)
    or exists (
      select 1 from public.admin_approval_requests pending
      where pending.business_id=v_draft.business_id
        and pending.shop_id=v_draft.shop_id
        and pending.action_type='CATALOG_PRICE_PUBLISH'
        and pending.status in ('PENDING','APPROVED','EXECUTING')
        and pending.command_payload->>'draftId'=v_draft.id::text
    )
  ) and not v_price_approved then
    return jsonb_build_object('ok',false,'code','catalog_price_approval_required');
  end if;

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
;

CREATE OR REPLACE FUNCTION public.schedule_catalog_draft_v1(p_employee_id uuid, p_draft_id uuid, p_expected_draft_revision bigint, p_expected_base_publish_version bigint, p_local_scheduled_at timestamp without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_schedule_resolution jsonb;
begin
  v_schedule_resolution := private.resolve_admin_cairo_schedule_v1(p_local_scheduled_at);
  if coalesce((v_schedule_resolution ->> 'ok')::boolean, false) is not true then
    return v_schedule_resolution;
  end if;

  -- Avoid changing ordinary schedule/rebase behavior when no price rule
  -- exists. Active price policy or an open price request requires preview/CAS.
  declare
    v_preview jsonb;
    v_business_id uuid;
    v_shop_id uuid;
  begin
    select business_id,shop_id into v_business_id,v_shop_id
      from public.catalog_drafts where id=p_draft_id;
    if exists (
      select 1 from public.admin_approval_rules r
      where r.business_id=v_business_id and r.active
        and r.action_type='CATALOG_PRICE_PUBLISH'
        and (r.shop_id=v_shop_id or r.shop_id is null)
    ) or exists (
      select 1 from public.admin_approval_requests a
      where a.business_id=v_business_id and a.shop_id=v_shop_id
        and a.action_type='CATALOG_PRICE_PUBLISH'
        and a.status in ('PENDING','APPROVED','EXECUTING')
        and a.command_payload->>'draftId'=p_draft_id::text
    ) then
      v_preview:=public.preview_admin_catalog_price_publish_v1(
        p_employee_id,p_draft_id,p_expected_draft_revision,
        p_expected_base_publish_version);
      if v_preview->>'ok' is distinct from 'true' then return v_preview; end if;
      if private.admin_catalog_price_requires_approval_v1(
        v_business_id,v_shop_id,(v_preview->>'maxPriceDeltaMinor')::bigint)
        or exists (
          select 1 from public.admin_approval_requests a
          where a.business_id=v_business_id and a.shop_id=v_shop_id
            and a.action_type='CATALOG_PRICE_PUBLISH'
            and a.status in ('PENDING','APPROVED','EXECUTING')
            and a.command_payload->>'draftId'=p_draft_id::text
        ) then
        return jsonb_build_object('ok',false,'code','catalog_price_approval_required');
      end if;
    end if;
  end;

  return private.schedule_catalog_draft_v1_pre_round15(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    p_expected_base_publish_version,
    p_local_scheduled_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_catalog_publish_version_v1(p_employee_id uuid, p_shop_id uuid, p_source_publish_version bigint, p_expected_current_publish_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_business_id uuid;
  v_source public.catalog_publish_versions%rowtype;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_pricing_changed boolean;
  v_restore_price_impact bigint;
begin
  if p_source_publish_version is null or p_source_publish_version < 1 or p_expected_current_publish_version is null or p_expected_current_publish_version < 0 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  v_business_id := private.assert_admin_catalog_permission_v1(p_employee_id,p_shop_id,'catalog.publish');
  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text,0));
  select coalesce(max(v.publish_version),0) into v_current_publish_version from public.catalog_publish_versions v where v.shop_id=p_shop_id;
  if p_expected_current_publish_version <> v_current_publish_version then return jsonb_build_object('ok',false,'code','stale_version','currentVersion',v_current_publish_version); end if;
  select * into v_source from public.catalog_publish_versions v where v.shop_id=p_shop_id and v.publish_version=p_source_publish_version;
  if not found or v_source.business_id <> v_business_id then return jsonb_build_object('ok',false,'code','publish_version_not_found'); end if;
  if p_source_publish_version >= v_current_publish_version then return jsonb_build_object('ok',false,'code','restore_source_must_be_historical'); end if;
  select coalesce(max(s.version),0) into v_current_operations_version from public.operations_configuration_snapshots s where s.shop_id=p_shop_id;
  v_bundle := private.merge_catalog_owned_draft_bundle_v1(p_shop_id,v_source.bundle_json,v_current_operations_version,now());
  select (
    exists(select 1 from jsonb_to_recordset(v_bundle->'snapshot'->'products') as source_product(id uuid,"priceMinor" bigint) left join public.products p on p.id=source_product.id and p.shop_id=p_shop_id where p.id is null or p.price_minor is distinct from source_product."priceMinor")
    or exists(select 1 from jsonb_to_recordset(v_bundle->'snapshot'->'modifiers') as source_modifier(id uuid,"priceMinor" bigint) left join public.modifiers m on m.id=source_modifier.id and m.shop_id=p_shop_id where m.id is null or m.price_minor is distinct from source_modifier."priceMinor")
  ) into v_pricing_changed;
  v_restore_price_impact:=private.admin_catalog_price_max_delta_v1(
    p_shop_id,v_bundle);
  -- Large rollback price changes may not silently bypass the publish approval
  -- action. The rollback UI must keep these fail-closed until separately approved.
  if private.admin_catalog_price_requires_approval_v1(
    v_business_id,p_shop_id,v_restore_price_impact)
    or exists (
      select 1 from public.admin_approval_requests a
      where a.business_id=v_business_id and a.shop_id=p_shop_id
        and a.action_type='CATALOG_PRICE_PUBLISH'
        and a.status in ('PENDING','APPROVED','EXECUTING')
    ) then
    return jsonb_build_object('ok',false,'code','catalog_price_approval_required');
  end if;
  if v_pricing_changed then perform private.assert_admin_catalog_permission_v1(p_employee_id,p_shop_id,'catalog.pricing'); end if;
  v_new_operations_version:=v_current_operations_version+1; v_new_publish_version:=v_current_publish_version+1;
  v_bundle:=private.normalize_admin_catalog_bundle_v1(p_shop_id,v_new_operations_version,now(),v_bundle);
  perform private.validate_admin_catalog_bundle_v1(p_shop_id,v_bundle);
  perform private.publish_admin_catalog_configuration_v1(p_shop_id,v_new_operations_version,v_bundle,null);
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id,v_bundle);
  perform private.sync_admin_master_catalog_v1(v_business_id,p_shop_id);
  insert into public.catalog_publish_versions(business_id,shop_id,publish_version,operations_configuration_version,source_kind,published_by_employee_id,restored_from_publish_version,bundle_json,published_at)
  values(v_business_id,p_shop_id,v_new_publish_version,v_new_operations_version,'ROLLBACK',p_employee_id,p_source_publish_version,v_bundle,now());
  return jsonb_build_object('ok',true,'sourcePublishVersion',p_source_publish_version,'publishVersion',v_new_publish_version,'operationsConfigurationVersion',v_new_operations_version);
end;
$function$
;

create or replace function public.execute_approved_admin_catalog_price_publish_v1(
 p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
 p_requester_employee_id uuid,p_approver_employee_id uuid,
 p_draft_id uuid,p_expected_draft_revision bigint,
 p_expected_publish_version bigint,p_max_price_delta_minor bigint,
 p_candidate_fingerprint text,p_command_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private
as $approved_catalog_price$
declare
 v_approval public.admin_approval_requests%rowtype;
 v_receipt private.admin_catalog_price_publish_approval_receipts%rowtype;
 v_expected jsonb;
 v_preview jsonb;
 v_result jsonb;
 v_requester_business uuid;
 v_approver_business uuid;
begin
 if p_approval_request_id is null or p_business_id is null
  or p_shop_id is null or p_requester_employee_id is null
  or p_approver_employee_id is null or p_draft_id is null
  or p_command_id is null or p_expected_draft_revision is null
  or p_expected_draft_revision<1 or p_expected_publish_version is null
  or p_expected_publish_version<0 or p_max_price_delta_minor is null
  or p_max_price_delta_minor<0 or p_candidate_fingerprint is null
  or p_candidate_fingerprint !~ '^[a-f0-9]{32}$' then
  return jsonb_build_object('ok',false,'code','invalid_approved_catalog_price');
 end if;
 select * into v_approval from public.admin_approval_requests
   where id=p_approval_request_id and business_id=p_business_id for update;
 if not found then return jsonb_build_object('ok',false,'code','approval_request_not_found'); end if;
 v_expected:=jsonb_build_object(
   'shopId',p_shop_id,'draftId',p_draft_id,
   'expectedDraftRevision',p_expected_draft_revision,
   'expectedVersion',p_expected_publish_version,
   'maxPriceDeltaMinor',p_max_price_delta_minor,
   'candidateFingerprint',p_candidate_fingerprint);
 if v_approval.action_type<>'CATALOG_PRICE_PUBLISH'
   or v_approval.shop_id is distinct from p_shop_id
   or v_approval.requester_employee_id<>p_requester_employee_id
   or v_approval.approver_employee_id is distinct from p_approver_employee_id
   or p_requester_employee_id=p_approver_employee_id
   or v_approval.required_approver_permission<>'approvals.review'
   or not v_approval.requires_second_person
   or v_approval.command_id<>p_command_id
   or v_approval.command_payload<>v_expected
   or v_approval.status not in ('EXECUTING','EXECUTED') then
  return jsonb_build_object('ok',false,'code','approval_catalog_price_payload_or_state_mismatch');
 end if;
 v_requester_business:=private.assert_admin_catalog_permission_v1(
   p_requester_employee_id,p_shop_id,'catalog.publish');
 perform private.assert_admin_catalog_permission_v1(
   p_requester_employee_id,p_shop_id,'catalog.pricing');
 v_approver_business:=private.assert_admin_settings_permission_v1(
   p_approver_employee_id,p_shop_id,'approvals.review');
 if v_requester_business is distinct from p_business_id
   or v_approver_business is distinct from p_business_id then
  return jsonb_build_object('ok',false,'code','approval_catalog_price_business_mismatch');
 end if;
 select * into v_receipt from private.admin_catalog_price_publish_approval_receipts
   where approval_request_id=p_approval_request_id for update;
 if found then
  if v_receipt.business_id<>p_business_id or v_receipt.shop_id<>p_shop_id
    or v_receipt.draft_id<>p_draft_id
    or v_receipt.approval_command_id<>p_command_id
    or v_receipt.expected_draft_revision<>p_expected_draft_revision
    or v_receipt.expected_publish_version<>p_expected_publish_version
    or v_receipt.max_price_delta_minor<>p_max_price_delta_minor
    or v_receipt.candidate_fingerprint<>p_candidate_fingerprint then
    return jsonb_build_object('ok',false,'code','approval_catalog_price_receipt_conflict');
  end if;
  return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
 end if;
 if v_approval.status<>'EXECUTING' then
  return jsonb_build_object('ok',false,'code','approval_catalog_price_not_claimed');
 end if;
 v_preview:=public.preview_admin_catalog_price_publish_v1(
  p_requester_employee_id,p_draft_id,p_expected_draft_revision,p_expected_publish_version);
 if v_preview->>'ok' is distinct from 'true' then return v_preview; end if;
 if v_preview->>'shopId' is distinct from p_shop_id::text
   or (v_preview->>'maxPriceDeltaMinor')::bigint<>p_max_price_delta_minor
   or v_preview->>'candidateFingerprint'<>p_candidate_fingerprint then
  return jsonb_build_object('ok',false,'code','catalog_price_candidate_changed');
 end if;
 perform set_config('tux.approved_catalog_price_request_id',
    p_approval_request_id::text,true);
 v_result:=public.publish_catalog_draft_v1(
    p_requester_employee_id,p_draft_id,p_expected_draft_revision,
    p_expected_publish_version);
 perform set_config('tux.approved_catalog_price_request_id','',true);
 if v_result->>'ok' is distinct from 'true' then return v_result; end if;
 insert into private.admin_catalog_price_publish_approval_receipts(
   approval_request_id,business_id,shop_id,draft_id,approval_command_id,
   expected_draft_revision,expected_publish_version,max_price_delta_minor,
   candidate_fingerprint,result_json
 ) values (
   p_approval_request_id,p_business_id,p_shop_id,p_draft_id,p_command_id,
   p_expected_draft_revision,p_expected_publish_version,p_max_price_delta_minor,
   p_candidate_fingerprint,v_result
 );
 perform public.append_admin_audit_event_v1(
   p_business_id,p_shop_id,p_approver_employee_id,
   'CATALOG_PRICE_APPROVED_PUBLISHED','CATALOG_DRAFT',p_draft_id::text,
   jsonb_build_object('baseVersion',p_expected_publish_version),
   jsonb_build_object('publishVersion',(v_result->>'publishVersion')::bigint),
   null,p_approval_request_id,null,
   jsonb_build_object('commandId',p_command_id,
     'candidateFingerprint',p_candidate_fingerprint,
     'maxPriceDeltaMinor',p_max_price_delta_minor)
 );
 return v_result;
end;
$approved_catalog_price$;

revoke all on function public.preview_admin_catalog_price_publish_v1(uuid,uuid,bigint,bigint)
 from public,anon,authenticated;
grant execute on function public.preview_admin_catalog_price_publish_v1(uuid,uuid,bigint,bigint)
 to service_role;
revoke all on function public.execute_approved_admin_catalog_price_publish_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid)
 from public,anon,authenticated;
grant execute on function public.execute_approved_admin_catalog_price_publish_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid)
 to service_role;
revoke all on function public.schedule_catalog_draft_v1(
 uuid,uuid,bigint,bigint,timestamp without time zone)
 from public,anon,authenticated;
grant execute on function public.schedule_catalog_draft_v1(
 uuid,uuid,bigint,bigint,timestamp without time zone)
 to service_role;
revoke all on function public.restore_catalog_publish_version_v1(uuid,uuid,bigint,bigint)
 from public,anon,authenticated;
grant execute on function public.restore_catalog_publish_version_v1(uuid,uuid,bigint,bigint)
 to service_role;

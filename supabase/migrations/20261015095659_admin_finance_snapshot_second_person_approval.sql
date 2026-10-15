-- PR #119 / Plan 3 and Plan 7: financially sensitive Z adjustment approval.
-- Exposes only service-role RPCs; preserves immutable published Z snapshots,
-- business boundary, original command receipts and existing auditing.
-- Every adjustment locks its parent Z snapshot for CAS serialization.

create or replace function private.admin_finance_snapshot_approval_policy_v1(
 p_business_id uuid,p_shop_id uuid,p_amount_minor bigint
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $policy$
declare
  v_rule public.admin_approval_rules%rowtype;
  v_threshold numeric;
begin
  select * into v_rule from public.admin_approval_rules r
   where r.business_id=p_business_id and r.action_type='FINANCE_SNAPSHOT_ADJUST'
     and r.active and (r.shop_id=p_shop_id or r.shop_id is null)
   order by case when r.shop_id=p_shop_id then 0 else 1 end,r.id
   limit 1;
  if not found then
    return jsonb_build_object('policyValid',true,'approvalRequired',false,
      'ruleId',null);
  end if;
  if v_rule.requester_permission<>'finance.adjust' or
     v_rule.approver_permission<>'approvals.review' or
     v_rule.requires_second_person is distinct from true or
     jsonb_typeof(v_rule.threshold_context)<>'object' or
     (select count(*) from jsonb_object_keys(v_rule.threshold_context) k)>1 or
     exists(select 1 from jsonb_object_keys(v_rule.threshold_context) k
            where k<>'minimumMinor') then
    return jsonb_build_object('policyValid',false,'approvalRequired',true,
       'ruleId',v_rule.id);
  end if;
  if v_rule.threshold_context ? 'minimumMinor' then
    if (v_rule.threshold_context->>'minimumMinor') !~ '^[0-9]{1,18}$'
       or (v_rule.threshold_context->>'minimumMinor')::numeric<=0 then
      return jsonb_build_object('policyValid',false,'approvalRequired',true,
         'ruleId',v_rule.id);
    end if;
    v_threshold:=(v_rule.threshold_context->>'minimumMinor')::numeric;
  else
    v_threshold:=0;
  end if;
  return jsonb_build_object(
    'policyValid',true,
    'approvalRequired',abs(p_amount_minor::numeric)>=v_threshold,
    'ruleId',v_rule.id,
    'minimumMinor',v_threshold);
end;
$policy$;
revoke all on function private.admin_finance_snapshot_approval_policy_v1(uuid,uuid,bigint)
from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.finance_adjust_snapshot_v1(p_actor_employee_id uuid, p_shop_id uuid, p_snapshot_id uuid, p_amount_minor bigint, p_reason text, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  v_business_id uuid; v_authorized boolean;
  v_existing public.financial_adjustments%rowtype;
  v_id uuid;
  v_policy jsonb;
  v_approval_id uuid;
  v_approved boolean;
  v_open_exact boolean;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.adjust') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_amount_minor is null or p_amount_minor=0
     or nullif(btrim(p_reason),'') is null or length(p_reason)>500
     or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','finance_adjustment_invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text||':finance-adjust:'||p_command_id,0));
  -- Serialize ALL adjustments to the same frozen snapshot across command
  -- IDs so approved expected count cannot race a different direct command.
  perform 1 from public.end_day_financial_snapshots z
    where z.id=p_snapshot_id and z.business_id=v_business_id
      and z.shop_id=p_shop_id for update;
  if not found then
    return jsonb_build_object('ok',false,'code','finance_snapshot_not_found');
  end if;
  v_policy:=private.admin_finance_snapshot_approval_policy_v1(
    v_business_id,p_shop_id,p_amount_minor);
  if v_policy->>'policyValid' is distinct from 'true' then
    return jsonb_build_object('ok',false,'code','finance_snapshot_approval_rule_invalid');
  end if;

  select exists(
    select 1 from public.admin_approval_requests a
    where a.business_id=v_business_id and a.shop_id=p_shop_id
      and a.action_type='FINANCE_SNAPSHOT_ADJUST'
      and a.requester_employee_id=p_actor_employee_id
      and a.status in ('PENDING','APPROVED','EXECUTING')
      and a.command_payload->>'snapshotId'=p_snapshot_id::text
      and a.command_payload->>'amountMinor'=p_amount_minor::text
      and a.command_payload->>'reason'=btrim(p_reason)
      and a.command_payload->>'commandId'=p_command_id
  ) into v_open_exact;
  v_approval_id:=nullif(
    current_setting('tux.approved_finance_snapshot_request_id',true),''
  )::uuid;
  select exists(
    select 1 from public.admin_approval_requests a
    where a.id=v_approval_id and a.business_id=v_business_id
      and a.shop_id=p_shop_id and a.action_type='FINANCE_SNAPSHOT_ADJUST'
      and a.requester_employee_id=p_actor_employee_id
      and a.approver_employee_id is not null
      and a.approver_employee_id<>p_actor_employee_id
      and a.status='EXECUTING'
      and a.command_payload->>'snapshotId'=p_snapshot_id::text
      and a.command_payload->>'amountMinor'=p_amount_minor::text
      and a.command_payload->>'reason'=btrim(p_reason)
      and a.command_payload->>'commandId'=p_command_id
  ) into v_approved;
  if ((v_policy->>'approvalRequired')::boolean or v_open_exact)
      and not v_approved then
    return jsonb_build_object('ok',false,'code','finance_snapshot_approval_required');
  end if;

  select * into v_existing from public.financial_adjustments
    where business_id=v_business_id and command_id=p_command_id;
  if found then
    if v_existing.snapshot_id=p_snapshot_id and v_existing.amount_minor=p_amount_minor
       and v_existing.reason=btrim(p_reason) and
       v_existing.created_by_employee_id=p_actor_employee_id then
      return jsonb_build_object('ok',true,'replayed',true,'adjustmentId',v_existing.id);
    end if;
    return jsonb_build_object('ok',false,'code','finance_command_conflict');
  end if;
  insert into public.financial_adjustments(
    business_id,shop_id,snapshot_id,amount_minor,reason,command_id,created_by_employee_id)
  values(v_business_id,p_shop_id,p_snapshot_id,p_amount_minor,
    btrim(p_reason),p_command_id,p_actor_employee_id) returning id into v_id;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_SNAPSHOT_ADJUSTED','FINANCIAL_SNAPSHOT',p_snapshot_id::text,
    null,jsonb_build_object('adjustmentId',v_id,'amountMinor',p_amount_minor),
    p_reason,null,null,'{}'::jsonb);
  return jsonb_build_object('ok',true,'replayed',false,'adjustmentId',v_id);
end;
$function$;

create or replace function public.preview_admin_finance_snapshot_adjustment_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_snapshot_id uuid,
 p_amount_minor bigint,p_reason text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $preview$
declare
 v_business uuid;v_allowed boolean;v_policy jsonb;v_count bigint;
begin
 select business_id,authorized into v_business,v_allowed
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.adjust');
 if not coalesce(v_allowed,false) or v_business is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 if p_amount_minor is null or p_amount_minor=0 or
    nullif(btrim(p_reason),'') is null or length(p_reason)>500 or
    nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
   return jsonb_build_object('ok',false,'code','finance_adjustment_invalid');
 end if;
 if not exists(select 1 from public.end_day_financial_snapshots
    where id=p_snapshot_id and shop_id=p_shop_id and business_id=v_business) then
   return jsonb_build_object('ok',false,'code','finance_snapshot_not_found');
 end if;
 v_policy:=private.admin_finance_snapshot_approval_policy_v1(
   v_business,p_shop_id,p_amount_minor);
 if v_policy->>'policyValid' is distinct from 'true' then
   return jsonb_build_object('ok',false,
     'code','finance_snapshot_approval_rule_invalid');
 end if;
 select count(*) into v_count from public.financial_adjustments
    where snapshot_id=p_snapshot_id and business_id=v_business and shop_id=p_shop_id;
 return jsonb_build_object(
  'ok',true,'businessId',v_business,'snapshotId',p_snapshot_id,
  'shopId',p_shop_id,'expectedAdjustmentCount',v_count,
  'approvalRequired',v_policy->'approvalRequired','ruleId',v_policy->'ruleId');
end;
$preview$;
revoke all on function public.preview_admin_finance_snapshot_adjustment_v1(
 uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.preview_admin_finance_snapshot_adjustment_v1(
 uuid,uuid,uuid,bigint,text,text) to service_role;

create table private.admin_finance_snapshot_approval_receipts (
 approval_request_id uuid primary key references public.admin_approval_requests(id),
 business_id uuid not null,
 shop_id uuid not null,
 snapshot_id uuid not null,
 command_id uuid not null,
 original_adjustment_command_id text not null,
 adjustment_id uuid not null references public.financial_adjustments(id),
 expected_adjustment_count bigint not null,
 result_json jsonb not null,
 created_at timestamptz not null default now(),
 unique(business_id,original_adjustment_command_id)
);
alter table private.admin_finance_snapshot_approval_receipts enable row level security;
revoke all on private.admin_finance_snapshot_approval_receipts
 from public,anon,authenticated,service_role;

create or replace function public.execute_approved_admin_finance_snapshot_adjustment_v1(
 p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
 p_requester_employee_id uuid,p_approver_employee_id uuid,
 p_snapshot_id uuid,p_amount_minor bigint,p_reason text,
 p_original_command_id text,p_expected_adjustment_count bigint,p_command_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $finance_execution$
declare
 v_request public.admin_approval_requests%rowtype;
 v_receipt private.admin_finance_snapshot_approval_receipts%rowtype;
 v_payload jsonb;
 v_count bigint;
 v_result jsonb;
 v_requester_business uuid;v_requester_allowed boolean;
 v_approver_business uuid;v_approver_allowed boolean;
begin
 if p_approval_request_id is null or p_business_id is null or
    p_shop_id is null or p_requester_employee_id is null or
    p_approver_employee_id is null or p_snapshot_id is null or
    p_command_id is null or p_amount_minor is null or p_amount_minor=0 or
    nullif(btrim(p_reason),'') is null or length(p_reason)>500 or
    nullif(btrim(p_original_command_id),'') is null or
    length(p_original_command_id)>160 or
    p_expected_adjustment_count is null or p_expected_adjustment_count<0 then
   return jsonb_build_object('ok',false,
     'code','invalid_approved_finance_snapshot_adjustment');
 end if;
 select * into v_request from public.admin_approval_requests
   where id=p_approval_request_id and business_id=p_business_id for update;
 if not found then
   return jsonb_build_object('ok',false,'code','approval_request_not_found');
 end if;
 v_payload:=jsonb_build_object(
   'shopId',p_shop_id,'snapshotId',p_snapshot_id,
   'amountMinor',p_amount_minor,'reason',btrim(p_reason),
   'commandId',p_original_command_id,
   'expectedAdjustmentCount',p_expected_adjustment_count);
 if v_request.shop_id is distinct from p_shop_id or
    v_request.action_type<>'FINANCE_SNAPSHOT_ADJUST' or
    v_request.requester_employee_id<>p_requester_employee_id or
    v_request.approver_employee_id is distinct from p_approver_employee_id or
    v_request.requester_employee_id=p_approver_employee_id or
    v_request.required_approver_permission<>'approvals.review' or
    v_request.command_id<>p_command_id or
    v_request.command_payload<>v_payload or
    v_request.status not in ('EXECUTING','EXECUTED') then
   return jsonb_build_object('ok',false,
      'code','approval_finance_snapshot_payload_or_state_mismatch');
 end if;
 select business_id,authorized into v_requester_business,v_requester_allowed
 from public.resolve_admin_authorization_v1(
   p_requester_employee_id,p_shop_id,'finance.adjust');
 select business_id,authorized into v_approver_business,v_approver_allowed
 from public.resolve_admin_authorization_v1(
   p_approver_employee_id,p_shop_id,'approvals.review');
 if not coalesce(v_requester_allowed,false) or
    not coalesce(v_approver_allowed,false) or
    v_requester_business is distinct from p_business_id or
    v_approver_business is distinct from p_business_id then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 select * into v_receipt from private.admin_finance_snapshot_approval_receipts
  where approval_request_id=p_approval_request_id for update;
 if found then
   if v_receipt.business_id<>p_business_id or
      v_receipt.shop_id<>p_shop_id or
      v_receipt.snapshot_id<>p_snapshot_id or
      v_receipt.command_id<>p_command_id or
      v_receipt.original_adjustment_command_id<>p_original_command_id or
      v_receipt.expected_adjustment_count<>p_expected_adjustment_count then
     return jsonb_build_object('ok',false,
       'code','approval_finance_snapshot_receipt_conflict');
   end if;
   return v_receipt.result_json||jsonb_build_object('idempotentReplay',true);
 end if;
 if v_request.status<>'EXECUTING' then
   return jsonb_build_object('ok',false,
     'code','approval_finance_snapshot_not_claimed');
 end if;
 -- Match the canonical direct command lock ordering before taking the Z row
 -- lock; concurrent direct/approved retries for one command cannot deadlock.
 perform pg_advisory_xact_lock(hashtextextended(
   p_business_id::text||':finance-adjust:'||p_original_command_id,0));
 perform 1 from public.end_day_financial_snapshots z
   where z.id=p_snapshot_id and z.shop_id=p_shop_id
     and z.business_id=p_business_id for update;
 if not found then
   return jsonb_build_object('ok',false,'code','finance_snapshot_not_found');
 end if;
 select count(*) into v_count from public.financial_adjustments
    where business_id=p_business_id and shop_id=p_shop_id and snapshot_id=p_snapshot_id;
 if v_count<>p_expected_adjustment_count then
   return jsonb_build_object('ok',false,'code','stale_finance_snapshot_adjustment');
 end if;
 perform set_config('tux.approved_finance_snapshot_request_id',
    p_approval_request_id::text,true);
 v_result:=public.finance_adjust_snapshot_v1(
    p_requester_employee_id,p_shop_id,p_snapshot_id,
    p_amount_minor,btrim(p_reason),p_original_command_id);
 perform set_config('tux.approved_finance_snapshot_request_id','',true);
 if v_result->>'ok' is distinct from 'true' then return v_result; end if;
 if v_result->>'replayed' is distinct from 'false' then
   return jsonb_build_object('ok',false,'code','finance_adjustment_preexisting_command');
 end if;
 insert into private.admin_finance_snapshot_approval_receipts(
   approval_request_id,business_id,shop_id,snapshot_id,command_id,
   original_adjustment_command_id,adjustment_id,expected_adjustment_count,result_json
 ) values (
   p_approval_request_id,p_business_id,p_shop_id,p_snapshot_id,p_command_id,
   p_original_command_id,(v_result->>'adjustmentId')::uuid,
   p_expected_adjustment_count,v_result
 );
 perform public.append_admin_audit_event_v1(
   p_business_id,p_shop_id,p_approver_employee_id,
   'FINANCE_SNAPSHOT_APPROVED_APPLIED','FINANCIAL_SNAPSHOT',p_snapshot_id::text,
   jsonb_build_object('expectedAdjustmentCount',p_expected_adjustment_count),
   jsonb_build_object('adjustmentId',v_result->>'adjustmentId',
                      'amountMinor',p_amount_minor),
   btrim(p_reason),p_approval_request_id,null,
   jsonb_build_object('commandId',p_command_id)
 );
 return v_result;
end;
$finance_execution$;
revoke all on function public.execute_approved_admin_finance_snapshot_adjustment_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,uuid)
 from public,anon,authenticated;
grant execute on function public.execute_approved_admin_finance_snapshot_adjustment_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,uuid) to service_role;

-- PR #119 Plans 3/7: cashier reconciliation must use trusted drawer variance.
-- Forward-only installed functions and RLS receipt table. No operational DML.
CREATE OR REPLACE FUNCTION public.finance_reconcile_cashier_v1(p_actor_employee_id uuid, p_shop_id uuid, p_business_day_id uuid, p_cashier_worker_id uuid, p_actual_minor bigint, p_reason text, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  v_business_id uuid; v_authorized boolean;
  v_day public.business_days%rowtype;
  v_existing public.cashier_reconciliations%rowtype;
  v_expected bigint; v_fingerprint text; v_id uuid;
  v_drawer jsonb;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.reconcile') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_actual_minor is null or p_actual_minor<0
    or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160
    or length(coalesce(p_reason,''))>500 then
    return jsonb_build_object('ok',false,'code','finance_reconciliation_invalid');
  end if;
  select * into v_day from public.business_days
    where id=p_business_day_id and shop_id=p_shop_id for update;
  if not found or v_day.status<>'CLOSED' then
    return jsonb_build_object('ok',false,'code','finance_day_must_be_closed');
  end if;
  if exists(select 1 from public.end_day_financial_snapshots z
    where z.business_id=v_business_id and z.business_day_id=v_day.id) then
    return jsonb_build_object('ok',false,'code','finance_day_already_finalized');
  end if;
  if not exists(select 1 from public.workers w
    where w.shop_id=p_shop_id and w.id=p_cashier_worker_id) then
    return jsonb_build_object('ok',false,'code','finance_cashier_invalid');
  end if;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'actor',p_actor_employee_id,'shop',p_shop_id,'day',p_business_day_id,
    'worker',p_cashier_worker_id,'actual',p_actual_minor,'reason',p_reason
  )::text,'UTF8'),'sha256'),'hex');

  select * into v_existing from public.cashier_reconciliations
    where business_id=v_business_id and shop_id=p_shop_id
      and business_day_id=p_business_day_id
      and cashier_worker_id=p_cashier_worker_id for update;
  if found then
    if v_existing.command_id=p_command_id
       and v_existing.request_fingerprint=v_fingerprint then
      return jsonb_build_object('ok',true,'replayed',true,'reconciliationId',v_existing.id);
    end if;
    return jsonb_build_object('ok',false,'code','finance_cashier_already_reconciled');
  end if;
  v_drawer:=private.plan7_drawer_facts_v1(v_business_id,p_shop_id,p_business_day_id,p_cashier_worker_id);
  v_expected:=(v_drawer->>'recordedDrawerExpectationMinor')::bigint;
  -- Pending command identity is irrevocable without its exact approved
  -- execution context, even after a rules administrator disables the rule.
  if exists (
    select 1 from public.admin_approval_requests ar
    where ar.business_id=v_business_id
      and ar.action_type='FINANCE_CASHIER_RECONCILIATION'
      and ar.command_payload->>'commandId'=p_command_id
      and ar.status in ('PENDING','APPROVED','EXECUTING')
  ) and not exists (
    select 1 from public.admin_approval_requests ar
    where ar.id=nullif(current_setting(
       'tux.approved_cashier_reconciliation_request_id',true),'')::uuid
      and ar.business_id=v_business_id and ar.shop_id=p_shop_id
      and ar.requester_employee_id=p_actor_employee_id
      and ar.action_type='FINANCE_CASHIER_RECONCILIATION'
      and ar.command_payload=jsonb_build_object(
        'shopId',p_shop_id,'businessDayId',p_business_day_id,
        'cashierWorkerId',p_cashier_worker_id,
        'actualMinor',p_actual_minor,'expectedMinor',v_expected,
        'reason',nullif(btrim(p_reason),''),
        'commandId',p_command_id)
      and ar.approver_employee_id is not null
      and ar.approver_employee_id<>ar.requester_employee_id
      and ar.status='EXECUTING'
  ) then
    return jsonb_build_object(
      'ok',false,'code','finance_cashier_approval_required');
  end if;
  declare
    v_rule public.admin_approval_rules%rowtype;
    v_minimum numeric;
  begin
    select * into v_rule from public.admin_approval_rules ar
    where ar.business_id=v_business_id and ar.active
      and ar.action_type='FINANCE_CASHIER_RECONCILIATION'
      and (ar.shop_id=p_shop_id or ar.shop_id is null)
    order by (ar.shop_id is not null) desc limit 1;
    if found then
      if v_rule.requester_permission<>'finance.reconcile'
         or v_rule.approver_permission<>'approvals.review'
         or not v_rule.requires_second_person
         or jsonb_typeof(v_rule.threshold_context)<>'object'
         or (select count(*) from jsonb_object_keys(v_rule.threshold_context))>1
         or (v_rule.threshold_context ? 'minimumMinor' and
           (jsonb_typeof(v_rule.threshold_context->'minimumMinor')<>'number'
           or (v_rule.threshold_context->>'minimumMinor') !~ '^[1-9][0-9]*
  if p_actual_minor<>v_expected and nullif(btrim(p_reason),'') is null then
    return jsonb_build_object('ok',false,'code','finance_variance_reason_required');
  end if;

  insert into public.cashier_reconciliations(
    business_id,shop_id,business_day_id,cashier_worker_id,
    expected_minor,actual_minor,variance_reason,reviewed_by_employee_id,
    command_id,request_fingerprint)
  values(v_business_id,p_shop_id,p_business_day_id,p_cashier_worker_id,
    v_expected,p_actual_minor,nullif(btrim(p_reason),''),
    p_actor_employee_id,p_command_id,v_fingerprint)
  returning id into v_id;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_CASHIER_RECONCILED','BUSINESS_DAY',p_business_day_id::text,
    null,jsonb_build_object('workerId',p_cashier_worker_id,'expected',v_expected,
      'actual',p_actual_minor),'Cashier reconciliation',null,null,'{}'::jsonb);
  return jsonb_build_object('ok',true,'replayed',false,
    'reconciliationId',v_id,'expectedMinor',v_expected,
    'actualMinor',p_actual_minor,'varianceMinor',p_actual_minor-v_expected,
    'cashSalesExpectationMinor',v_drawer->'cashSalesExpectationMinor',
    'recordedCashMovementMinor',v_drawer->'recordedCashMovementMinor',
    'openingFloatRecorded',v_drawer->'openingFloatRecorded');
end;
$function$

           or length(v_rule.threshold_context->>'minimumMinor')>16))
      then return jsonb_build_object(
        'ok',false,'code','finance_cashier_approval_rule_invalid');end if;
      v_minimum:=nullif(v_rule.threshold_context->>'minimumMinor','')::numeric;
      if (v_minimum is null or abs(p_actual_minor::numeric-v_expected::numeric)>=v_minimum)
        and not exists (
        select 1 from public.admin_approval_requests ar
        where ar.id=nullif(current_setting(
          'tux.approved_cashier_reconciliation_request_id',true),'')::uuid
          and ar.business_id=v_business_id
          and ar.shop_id=p_shop_id
          and ar.requester_employee_id=p_actor_employee_id
          and ar.action_type='FINANCE_CASHIER_RECONCILIATION'
          and ar.approver_employee_id is not null
          and ar.approver_employee_id<>ar.requester_employee_id
          and ar.status='EXECUTING'
          and ar.command_payload=jsonb_build_object(
            'shopId',p_shop_id,'businessDayId',p_business_day_id,
            'cashierWorkerId',p_cashier_worker_id,'actualMinor',p_actual_minor,
            'expectedMinor',v_expected,'reason',nullif(btrim(p_reason),''),
            'commandId',p_command_id)
      ) then return jsonb_build_object(
        'ok',false,'code','finance_cashier_approval_required');end if;
    end if;
  end;

  if p_actual_minor<>v_expected and nullif(btrim(p_reason),'') is null then
    return jsonb_build_object('ok',false,'code','finance_variance_reason_required');
  end if;

  insert into public.cashier_reconciliations(
    business_id,shop_id,business_day_id,cashier_worker_id,
    expected_minor,actual_minor,variance_reason,reviewed_by_employee_id,
    command_id,request_fingerprint)
  values(v_business_id,p_shop_id,p_business_day_id,p_cashier_worker_id,
    v_expected,p_actual_minor,nullif(btrim(p_reason),''),
    p_actor_employee_id,p_command_id,v_fingerprint)
  returning id into v_id;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_CASHIER_RECONCILED','BUSINESS_DAY',p_business_day_id::text,
    null,jsonb_build_object('workerId',p_cashier_worker_id,'expected',v_expected,
      'actual',p_actual_minor),'Cashier reconciliation',null,null,'{}'::jsonb);
  return jsonb_build_object('ok',true,'replayed',false,
    'reconciliationId',v_id,'expectedMinor',v_expected,
    'actualMinor',p_actual_minor,'varianceMinor',p_actual_minor-v_expected,
    'cashSalesExpectationMinor',v_drawer->'cashSalesExpectationMinor',
    'recordedCashMovementMinor',v_drawer->'recordedCashMovementMinor',
    'openingFloatRecorded',v_drawer->'openingFloatRecorded');
end;
$function$


create or replace function public.preview_admin_finance_cashier_reconciliation_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid,
 p_cashier_worker_id uuid,p_actual_minor bigint,p_reason text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions
as $preview$
declare
 v_business uuid;
 v_authorized boolean;
 v_day public.business_days%rowtype;
 v_existing public.cashier_reconciliations%rowtype;
 v_drawer jsonb;
 v_expected bigint;
 v_rule public.admin_approval_rules%rowtype;
 v_minimum numeric;
 v_variance numeric;
begin
 select a.business_id,a.authorized into v_business,v_authorized
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.reconcile') a;
 if not coalesce(v_authorized,false) or v_business is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');end if;
 if p_business_day_id is null or p_cashier_worker_id is null or
    p_actual_minor is null or p_actual_minor not between 0 and 900000000000000
    or p_command_id is null or length(btrim(p_command_id)) not between 1 and 160
    or length(coalesce(p_reason,''))>500
 then return jsonb_build_object(
   'ok',false,'code','finance_reconciliation_invalid');end if;
 select * into v_day from public.business_days
 where id=p_business_day_id and shop_id=p_shop_id;
 if not found or v_day.status<>'CLOSED' then
   return jsonb_build_object('ok',false,'code','finance_day_must_be_closed');end if;
 if exists(select 1 from public.end_day_financial_snapshots z
   where z.business_id=v_business and z.business_day_id=v_day.id) then
   return jsonb_build_object('ok',false,'code','finance_day_already_finalized');end if;
 if not exists(select 1 from public.workers w
   where w.shop_id=p_shop_id and w.id=p_cashier_worker_id) then
   return jsonb_build_object('ok',false,'code','finance_cashier_invalid');end if;
 select * into v_existing from public.cashier_reconciliations
 where business_id=v_business and shop_id=p_shop_id
   and business_day_id=p_business_day_id
   and cashier_worker_id=p_cashier_worker_id;
 if found then return jsonb_build_object(
  'ok',false,'code','finance_cashier_already_reconciled');end if;
 v_drawer:=private.plan7_drawer_facts_v1(
   v_business,p_shop_id,p_business_day_id,p_cashier_worker_id);
 v_expected:=(v_drawer->>'recordedDrawerExpectationMinor')::bigint;
 v_variance:=abs(p_actual_minor::numeric-v_expected::numeric);
 if v_variance>9007199254740991 then
   return jsonb_build_object('ok',false,'code','finance_cashier_variance_invalid');end if;
 if p_actual_minor<>v_expected and nullif(btrim(p_reason),'') is null then
   return jsonb_build_object('ok',false,'code','finance_variance_reason_required');end if;
 select * into v_rule from public.admin_approval_rules ar
 where ar.business_id=v_business and ar.active
   and ar.action_type='FINANCE_CASHIER_RECONCILIATION'
   and (ar.shop_id=p_shop_id or ar.shop_id is null)
 order by (ar.shop_id is not null) desc limit 1;
 if found then
   if v_rule.requester_permission<>'finance.reconcile'
      or v_rule.approver_permission<>'approvals.review'
      or not v_rule.requires_second_person
      or jsonb_typeof(v_rule.threshold_context)<>'object'
      or (select count(*) from jsonb_object_keys(v_rule.threshold_context))>1
      or (v_rule.threshold_context ? 'minimumMinor' and
        (jsonb_typeof(v_rule.threshold_context->'minimumMinor')<>'number'
          or (v_rule.threshold_context->>'minimumMinor') !~ '^[1-9][0-9]*$'
          or length(v_rule.threshold_context->>'minimumMinor')>16))
   then return jsonb_build_object(
     'ok',false,'code','finance_cashier_rule_invalid');end if;
   v_minimum:=nullif(v_rule.threshold_context->>'minimumMinor','')::numeric;
 end if;
 return jsonb_build_object(
  'ok',true,'businessId',v_business,'shopId',p_shop_id,
  'businessDayId',p_business_day_id,'cashierWorkerId',p_cashier_worker_id,
  'expectedMinor',v_expected,'varianceMinor',v_variance,
  'approvalRequired',v_rule.id is not null and
    (v_minimum is null or v_variance>=v_minimum),'ruleId',v_rule.id);
end;
$preview$;
revoke all on function public.preview_admin_finance_cashier_reconciliation_v1(
 uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.preview_admin_finance_cashier_reconciliation_v1(
 uuid,uuid,uuid,uuid,bigint,text,text) to service_role;

create table private.admin_finance_cashier_reconciliation_approval_receipts (
 approval_request_id uuid primary key references public.admin_approval_requests(id),
 business_id uuid not null,
 original_command_id text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now(),
 unique(business_id,original_command_id)
);
alter table private.admin_finance_cashier_reconciliation_approval_receipts
 enable row level security;
revoke all on private.admin_finance_cashier_reconciliation_approval_receipts
 from public,anon,authenticated,service_role;

create or replace function public.execute_approved_admin_cashier_reconciliation_v1(
 p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
 p_requester_employee_id uuid,p_approver_employee_id uuid,
 p_business_day_id uuid,p_cashier_worker_id uuid,
 p_actual_minor bigint,p_expected_minor bigint,p_reason text,
 p_original_command_id text,p_approval_command_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions
as $execute$
declare
 v_request public.admin_approval_requests%rowtype;
 v_receipt private.admin_finance_cashier_reconciliation_approval_receipts%rowtype;
 v_business uuid;
 v_allowed boolean;
 v_approver_business uuid;
 v_day public.business_days%rowtype;
 v_expected jsonb;
 v_drawer jsonb;
 v_result jsonb;
begin
 if p_approval_request_id is null or p_business_id is null or p_shop_id is null
    or p_requester_employee_id is null or p_approver_employee_id is null
    or p_requester_employee_id=p_approver_employee_id
    or p_business_day_id is null or p_cashier_worker_id is null
    or p_approval_command_id is null
    or p_actual_minor is null or p_actual_minor not between 0 and 900000000000000
    or p_expected_minor is null or abs(p_expected_minor::numeric)>9007199254740991
    or p_original_command_id is null
    or length(btrim(p_original_command_id)) not between 1 and 160
    or length(coalesce(p_reason,''))>500
 then return jsonb_build_object('ok',false,'code','invalid_approved_cashier_reconciliation');end if;
 select * into v_request from public.admin_approval_requests
 where id=p_approval_request_id and business_id=p_business_id for update;
 v_expected:=jsonb_build_object(
   'shopId',p_shop_id,'businessDayId',p_business_day_id,
   'cashierWorkerId',p_cashier_worker_id,'actualMinor',p_actual_minor,
   'expectedMinor',p_expected_minor,'reason',nullif(btrim(p_reason),''),
   'commandId',p_original_command_id);
 if not found or v_request.shop_id is distinct from p_shop_id
    or v_request.action_type<>'FINANCE_CASHIER_RECONCILIATION'
    or v_request.requester_employee_id<>p_requester_employee_id
    or v_request.approver_employee_id is distinct from p_approver_employee_id
    or v_request.command_id is distinct from p_approval_command_id
    or v_request.command_payload<>v_expected
    or v_request.required_approver_permission<>'approvals.review'
    or not v_request.requires_second_person
    or v_request.status not in ('EXECUTING','EXECUTED')
 then return jsonb_build_object('ok',false,
   'code','approval_cashier_payload_or_state_mismatch');end if;
 select a.business_id,a.authorized into v_business,v_allowed
 from public.resolve_admin_authorization_v1(
   p_requester_employee_id,p_shop_id,'finance.reconcile') a;
 select a.business_id into v_approver_business
 from public.resolve_admin_authorization_v1(
   p_approver_employee_id,p_shop_id,'approvals.review') a
 where a.authorized=true;
 if not coalesce(v_allowed,false) or v_business is distinct from p_business_id
    or v_approver_business is distinct from p_business_id
 then return jsonb_build_object('ok',false,'code','approval_cashier_permission_revoked');end if;
 select * into v_receipt from private.admin_finance_cashier_reconciliation_approval_receipts
 where approval_request_id=p_approval_request_id for update;
 if found then
   if v_receipt.business_id<>p_business_id
      or v_receipt.original_command_id<>p_original_command_id
   then return jsonb_build_object('ok',false,'code','approval_cashier_receipt_conflict');end if;
   return v_receipt.receipt||jsonb_build_object('idempotentReplay',true);
 end if;
 if v_request.status<>'EXECUTING' then
   return jsonb_build_object('ok',false,'code','approval_cashier_not_claimed');end if;
 -- Under the same day lock as the canonical reconciler, compare the originally
 -- approved expected cash with current drawer facts before any posting.
 select * into v_day from public.business_days
 where id=p_business_day_id and shop_id=p_shop_id for update;
 if not found or v_day.status<>'CLOSED' then
   return jsonb_build_object('ok',false,'code','finance_day_must_be_closed');end if;
 if exists(select 1 from public.cashier_reconciliations c
   where c.shop_id=p_shop_id and c.business_day_id=p_business_day_id
     and c.cashier_worker_id=p_cashier_worker_id) then
   return jsonb_build_object('ok',false,'code','approval_cashier_already_posted');end if;
 v_drawer:=private.plan7_drawer_facts_v1(
   p_business_id,p_shop_id,p_business_day_id,p_cashier_worker_id);
 if (v_drawer->>'recordedDrawerExpectationMinor')::bigint is distinct from p_expected_minor
 then return jsonb_build_object('ok',false,'code','approval_cashier_drawer_stale');end if;
 perform set_config('tux.approved_cashier_reconciliation_request_id',
   p_approval_request_id::text,true);
 v_result:=public.finance_reconcile_cashier_v1(
   p_requester_employee_id,p_shop_id,p_business_day_id,
   p_cashier_worker_id,p_actual_minor,nullif(btrim(p_reason),''),
   p_original_command_id);
 perform set_config('tux.approved_cashier_reconciliation_request_id','',true);
 if v_result->>'ok' is distinct from 'true' then return v_result;end if;
 insert into private.admin_finance_cashier_reconciliation_approval_receipts(
   approval_request_id,business_id,original_command_id,receipt)
 values(p_approval_request_id,p_business_id,p_original_command_id,v_result);
 perform public.append_admin_audit_event_v1(
   p_business_id,p_shop_id,p_approver_employee_id,
   'FINANCE_CASHIER_RECONCILIATION_APPROVED_APPLIED',
   'BUSINESS_DAY',p_business_day_id::text,
   null,jsonb_build_object('actualMinor',p_actual_minor,
     'expectedMinor',p_expected_minor,
     'workerId',p_cashier_worker_id,'requestId',p_approval_request_id),
   null,p_approval_request_id,null,
   jsonb_build_object('originalCommandId',p_original_command_id));
 return v_result;
end;
$execute$;
revoke all on function public.execute_approved_admin_cashier_reconciliation_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.execute_approved_admin_cashier_reconciliation_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,text,uuid)
 to service_role;

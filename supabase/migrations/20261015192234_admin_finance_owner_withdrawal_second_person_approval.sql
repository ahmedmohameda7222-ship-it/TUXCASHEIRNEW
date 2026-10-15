-- PR #119 / Plan 7: owner withdrawal second-person approvals.
-- Forward only; existing Finance operation effects remain canonical and
-- atomic, no operational data modified by migration application.
-- Pre-image Finance command source MD5: 0396bce431a9803011b81c236ffa76cb.
CREATE OR REPLACE FUNCTION public.execute_finance_management_v1(p_actor_employee_id uuid, p_shop_id uuid, p_action text, p_payload jsonb, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'extensions'
AS $function$
declare
  v_business_id uuid;
  v_authorized boolean;
  v_actor_role text;
  v_permission text;
  v_fingerprint text;
  v_old private.finance_management_commands%rowtype;
  v_amount bigint;
  v_fee bigint;
  v_net bigint;
  v_from uuid;
  v_to uuid;
  v_account public.finance_accounts%rowtype;
  v_account_to public.finance_accounts%rowtype;
  v_reason text;
  v_day uuid;
  v_date date;
  v_category uuid;
  v_expense_id uuid;
  v_movement_id uuid;
  v_settlement_id uuid;
  v_result jsonb;
  v_effects jsonb := '[]'::jsonb;
  v_effect jsonb;
  v_effect_name text;
  v_effect_amount bigint;
  v_effect_account uuid;
  v_payment_effect text;
  v_rule public.admin_approval_rules%rowtype;
  v_minimum numeric;
  v_approval_context uuid;
  v_original_payload jsonb;
begin
  if p_action not in ('TRANSFER','BANK_DEPOSIT','OWNER_CONTRIBUTION',
                      'OWNER_WITHDRAWAL','EXPENSE','SETTLEMENT')
     or p_payload is null or jsonb_typeof(p_payload)<>'object'
     or p_command_id is null or length(btrim(p_command_id))<1
     or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','finance_request_invalid');
  end if;
  v_permission := case when p_action='SETTLEMENT' then 'finance.reconcile'
                       else 'finance.adjust' end;
  select a.business_id,a.authorized,a.employee_role into v_business_id,v_authorized,v_actor_role
    from public.resolve_admin_authorization_v1(
      p_actor_employee_id,p_shop_id,v_permission) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;

  -- Owner capital is not an ordinary shop expense/transfer.
  if p_action in ('OWNER_CONTRIBUTION','OWNER_WITHDRAWAL')
     and coalesce(v_actor_role,'') not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(
    jsonb_build_object('actor',p_actor_employee_id,'shop',p_shop_id,
      'action',p_action,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text||':p7-management:'||p_command_id,0));
  select * into v_old from private.finance_management_commands
    where business_id=v_business_id and command_id=p_command_id;
  if found then
    if v_old.request_fingerprint<>v_fingerprint then
      return jsonb_build_object('ok',false,'code','finance_command_conflict');
    end if;
    return v_old.receipt || jsonb_build_object('replayed',true);
  end if;

  begin
    v_amount := (p_payload->>'amountMinor')::bigint;
    v_from := nullif(p_payload->>'fromAccountId','')::uuid;
    v_to := nullif(p_payload->>'toAccountId','')::uuid;
    v_fee := coalesce((p_payload->>'feeMinor')::bigint,0);
    v_day := nullif(p_payload->>'businessDayId','')::uuid;
    v_date := coalesce(nullif(p_payload->>'expenseDate','')::date,
                       (now() at time zone 'Africa/Cairo')::date);
    v_category := nullif(p_payload->>'categoryId','')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range
               or datetime_field_overflow then
    return jsonb_build_object('ok',false,'code','finance_request_invalid');
  end;
  v_reason := nullif(btrim(p_payload->>'reason'),'');
  if v_amount is null or v_amount<=0 or v_amount>900000000000000 then
    return jsonb_build_object('ok',false,'code','finance_amount_invalid');
  end if;
  if v_reason is null or length(v_reason)>500 then
    return jsonb_build_object('ok',false,'code','finance_reason_required');
  end if;
  if p_action='OWNER_WITHDRAWAL' then
    -- Original business-wide command ID is fenced even if an administrator
    -- deactivates the rule or changes amount/account/reason after request.
    select r.* into v_rule from public.admin_approval_rules r
    where r.business_id=v_business_id
      and r.action_type='FINANCE_OWNER_WITHDRAWAL'
      and r.active and (r.shop_id=p_shop_id or r.shop_id is null)
    order by (r.shop_id is not null) desc limit 1;
    if found then
      if v_rule.requester_permission<>'finance.adjust' or
         v_rule.approver_permission<>'approvals.review' or
         not v_rule.requires_second_person or
         jsonb_typeof(v_rule.threshold_context)<>'object' or
         (select count(*) from jsonb_object_keys(v_rule.threshold_context))>1 or
         (v_rule.threshold_context ? 'minimumMinor' and
           (jsonb_typeof(v_rule.threshold_context->'minimumMinor')<>'number'
            or (v_rule.threshold_context->>'minimumMinor') !~ '^[1-9][0-9]*$'
            or length(v_rule.threshold_context->>'minimumMinor')>16))
      then return jsonb_build_object('ok',false,
        'code','finance_owner_withdrawal_rule_invalid'); end if;
      v_minimum := nullif(v_rule.threshold_context->>'minimumMinor','')::numeric;
    else
      v_minimum:=null;
    end if;
    v_original_payload:=jsonb_build_object('shopId',p_shop_id,
      'accountId',v_from,'amountMinor',v_amount,
      'reason',v_reason,'commandId',p_command_id);
    v_approval_context:=nullif(
      current_setting('tux.approved_owner_withdrawal_request_id',true),'')::uuid;
    if (v_rule.id is not null and
          (v_minimum is null or v_amount::numeric >= v_minimum))
       or exists (
          select 1 from public.admin_approval_requests open_request
          where open_request.business_id=v_business_id
            and open_request.action_type='FINANCE_OWNER_WITHDRAWAL'
            and open_request.status in ('PENDING','APPROVED','EXECUTING')
            and open_request.command_payload->>'commandId'=p_command_id
       )
    then
      if not exists(
        select 1 from public.admin_approval_requests approved
        where approved.id=v_approval_context
          and approved.business_id=v_business_id
          and approved.shop_id=p_shop_id
          and approved.action_type='FINANCE_OWNER_WITHDRAWAL'
          and approved.status='EXECUTING'
          and approved.requester_employee_id=p_actor_employee_id
          and approved.approver_employee_id is not null
          and approved.approver_employee_id<>p_actor_employee_id
          and approved.command_payload=v_original_payload
      ) then
        return jsonb_build_object('ok',false,
          'code','finance_owner_withdrawal_approval_required');
      end if;
    end if;
  end if;

  if p_action in ('TRANSFER','BANK_DEPOSIT','SETTLEMENT') then
    if v_from is null or v_to is null or v_from=v_to then
      return jsonb_build_object('ok',false,'code','finance_distinct_accounts_required');
    end if;
  elsif p_action in ('OWNER_CONTRIBUTION','OWNER_WITHDRAWAL','EXPENSE') then
    if v_to is not null then
      return jsonb_build_object('ok',false,'code','finance_account_scope_invalid');
    end if;
  end if;

  -- Lock all referenced account rows in a stable order to avoid opposite-transfer
  -- deadlocks. The READ model never supplies authority.
  perform id from public.finance_accounts
    where business_id=v_business_id and id in (v_from,v_to)
    order by id for update;
  if v_from is not null then
    select * into v_account from public.finance_accounts
      where business_id=v_business_id and id=v_from;
    if not found or not v_account.active or
       (v_account.shop_id is not null and v_account.shop_id<>p_shop_id) then
      return jsonb_build_object('ok',false,'code','finance_source_account_forbidden');
    end if;
  end if;
  if v_to is not null then
    select * into v_account_to from public.finance_accounts
      where business_id=v_business_id and id=v_to;
    if not found or not v_account_to.active or
       (v_account_to.shop_id is not null and v_account_to.shop_id<>p_shop_id) then
      return jsonb_build_object('ok',false,'code','finance_destination_account_forbidden');
    end if;
  end if;

  -- Business-wide treasury accounts are not available to a shop-only manager
  -- through a shop-scoped finance.adjust grant.
  if ((v_from is not null and v_account.shop_id is null)
      or (v_to is not null and v_account_to.shop_id is null))
     and coalesce(v_actor_role,'') not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;

  if p_action='BANK_DEPOSIT' and
     (v_account.account_type<>'CASH' or v_account_to.account_type<>'BANK') then
    return jsonb_build_object('ok',false,'code','finance_bank_deposit_accounts_invalid');
  end if;

  if p_action in ('TRANSFER','BANK_DEPOSIT') then
    v_effects:=jsonb_build_array(
      jsonb_build_object('accountId',v_from,'effect','OUT',
        'movementType','TRANSFER_OUT','amountMinor',-v_amount),
      jsonb_build_object('accountId',v_to,'effect','IN',
        'movementType','TRANSFER_IN','amountMinor',v_amount));
  elsif p_action='OWNER_CONTRIBUTION' then
    if v_from is null then return jsonb_build_object('ok',false,'code','finance_account_required'); end if;
    v_effects:=jsonb_build_array(jsonb_build_object('accountId',v_from,
      'effect','PRIMARY','movementType','OWNER_CONTRIBUTION','amountMinor',v_amount));
  elsif p_action='OWNER_WITHDRAWAL' then
    if v_from is null then return jsonb_build_object('ok',false,'code','finance_account_required'); end if;
    v_effects:=jsonb_build_array(jsonb_build_object('accountId',v_from,
      'effect','PRIMARY','movementType','OWNER_WITHDRAWAL','amountMinor',-v_amount));
  elsif p_action='SETTLEMENT' then
    if v_account.account_type<>'PENDING_SETTLEMENT' or
       v_account_to.account_type not in ('BANK','WALLET')
       or v_fee<0 or v_fee>=v_amount then
      return jsonb_build_object('ok',false,'code','finance_settlement_invalid');
    end if;
    v_net:=v_amount-v_fee;
    v_effects:=jsonb_build_array(
      jsonb_build_object('accountId',v_from,'effect','SOURCE',
        'movementType','SETTLEMENT','amountMinor',-v_net),
      jsonb_build_object('accountId',v_to,'effect','DEST',
        'movementType','SETTLEMENT','amountMinor',v_net));
    if v_fee>0 then v_effects:=v_effects||jsonb_build_array(
      jsonb_build_object('accountId',v_from,'effect','FEE',
        'movementType','BANK_FEE','amountMinor',-v_fee)); end if;
  elsif p_action='EXPENSE' then
    if v_day is null or length(coalesce(p_payload->>'description',''))>500 or
       nullif(btrim(p_payload->>'description'),'') is null then
      return jsonb_build_object('ok',false,'code','finance_expense_invalid');
    end if;
    perform 1 from public.business_days
      where id=v_day and shop_id=p_shop_id and status='OPEN' for update;
    if not found then
      return jsonb_build_object('ok',false,'code','finance_expense_day_not_open');
    end if;
    if v_category is not null and not exists(
       select 1 from public.expense_categories
       where business_id=v_business_id and id=v_category and active
         and (shop_id is null or shop_id=p_shop_id)) then
      return jsonb_build_object('ok',false,'code','finance_expense_category_forbidden');
    end if;
    v_expense_id:=gen_random_uuid();
    insert into public.expenses(id,shop_id,business_day_id,kind,description,
      amount_minor,paid_from,note,created_by_worker_id,created_by_employee_id,
      created_at,updated_at)
    values(v_expense_id,p_shop_id,v_day,'MANUAL',
      btrim(p_payload->>'description'),v_amount,
      case when v_from is not null and v_account.account_type='CASH'
           then 'CASH' else 'OTHER' end,v_reason,null,p_actor_employee_id,now(),now());
    if v_from is not null then
      v_effects:=jsonb_build_array(jsonb_build_object('accountId',v_from,
        'effect','PRIMARY','movementType','EXPENSE','amountMinor',-v_amount));
    end if;
  end if;

  for v_effect in select * from jsonb_array_elements(v_effects) loop
    v_effect_name:=v_effect->>'effect';
    v_effect_amount:=(v_effect->>'amountMinor')::bigint;
    v_effect_account:=(v_effect->>'accountId')::uuid;
    insert into public.finance_movements(
      business_id,shop_id,finance_account_id,movement_type,amount_minor,
      command_id,command_effect,request_fingerprint,actor_employee_id,
      source_kind,source_id,source_effect)
    values(v_business_id,p_shop_id,v_effect_account,v_effect->>'movementType',
      v_effect_amount,'plan7:'||p_command_id,v_effect_name,v_fingerprint,
      p_actor_employee_id,
      case when p_action='EXPENSE' then 'ADMIN_EXPENSE'
           when p_action='SETTLEMENT' then 'PAYMENT_SETTLEMENT'
           else null end,
      case when p_action='EXPENSE' then v_expense_id::text
           when p_action='SETTLEMENT' then p_command_id else null end,
      case when p_action in ('EXPENSE','SETTLEMENT') then v_effect_name else null end)
    returning id into v_movement_id;
  end loop;

  if p_action='EXPENSE' then
    insert into public.admin_expense_finance_details(
      business_id,shop_id,expense_id,category_id,expense_date,
      receipt_reference,finance_account_id,finance_movement_id)
    values(v_business_id,p_shop_id,v_expense_id,v_category,v_date,
      nullif(p_payload->>'receiptReference',''),v_from,
      case when v_from is not null then v_movement_id else null end);
  elsif p_action='SETTLEMENT' then
    insert into public.payment_settlements(
      business_id,shop_id,source_account_id,destination_account_id,
      gross_minor,fee_minor,net_minor,settled_on,reference,
      command_id,request_fingerprint,created_by_employee_id)
    values(v_business_id,p_shop_id,v_from,v_to,v_amount,v_fee,v_net,
      coalesce(nullif(p_payload->>'settledOn','')::date,
               (now() at time zone 'Africa/Cairo')::date),
      v_reason,p_command_id,v_fingerprint,p_actor_employee_id)
    returning id into v_settlement_id;
  end if;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,
    p_actor_employee_id,'FINANCE_'||p_action,'FINANCE_COMMAND',p_command_id,
    null,jsonb_build_object('action',p_action,'amountMinor',v_amount,
      'sourceAccountId',v_from,'destinationAccountId',v_to,
      'expenseId',v_expense_id,'settlementId',v_settlement_id),
    v_reason,null,null,'{}'::jsonb);
  v_result:=jsonb_build_object('ok',true,'replayed',false,
    'commandId',p_command_id,'expenseId',v_expense_id,'settlementId',v_settlement_id);
  insert into private.finance_management_commands(
    business_id,command_id,request_fingerprint,receipt)
  values(v_business_id,p_command_id,v_fingerprint,v_result);
  return v_result;
end;
$function$;


-- Preview independently checks current trusted actor, tenant, target account,
-- and the currently selected shop-scoped-over-business-wide threshold.
create or replace function public.preview_admin_finance_owner_withdrawal_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_account_id uuid,
 p_amount_minor bigint,p_reason text,p_command_id text
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,private
as $preview$
declare
 v_business uuid;
 v_authorized boolean;
 v_role text;
 v_account public.finance_accounts%rowtype;
 v_rule public.admin_approval_rules%rowtype;
 v_minimum numeric;
begin
 if p_actor_employee_id is null or p_shop_id is null or p_account_id is null
    or p_amount_minor is null or p_amount_minor not between 1 and 900000000000000
    or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_command_id is null or length(btrim(p_command_id)) not between 1 and 160
 then return jsonb_build_object('ok',false,'code','finance_request_invalid'); end if;
 select a.business_id,a.authorized,a.employee_role
   into v_business,v_authorized,v_role
 from public.resolve_admin_authorization_v1(
 p_actor_employee_id,p_shop_id,'finance.adjust') a;
 if not coalesce(v_authorized,false) or v_business is null or
   coalesce(v_role,'') not in ('OWNER','ADMIN')
 then return jsonb_build_object('ok',false,'code','permission_forbidden'); end if;
 select * into v_account from public.finance_accounts
 where id=p_account_id and business_id=v_business;
 if not found or not v_account.active or
   (v_account.shop_id is not null and v_account.shop_id<>p_shop_id)
 then return jsonb_build_object('ok',false,
   'code','finance_source_account_forbidden'); end if;
 select * into v_rule from public.admin_approval_rules r
 where r.business_id=v_business and r.active
   and r.action_type='FINANCE_OWNER_WITHDRAWAL'
   and (r.shop_id=p_shop_id or r.shop_id is null)
 order by (r.shop_id is not null) desc limit 1;
 if found then
   if v_rule.requester_permission<>'finance.adjust' or
      v_rule.approver_permission<>'approvals.review' or
      not v_rule.requires_second_person or
      jsonb_typeof(v_rule.threshold_context)<>'object' or
      (select count(*) from jsonb_object_keys(v_rule.threshold_context))>1 or
      (v_rule.threshold_context ? 'minimumMinor' and
       (jsonb_typeof(v_rule.threshold_context->'minimumMinor')<>'number'
        or (v_rule.threshold_context->>'minimumMinor') !~ '^[1-9][0-9]*$'
        or length(v_rule.threshold_context->>'minimumMinor')>16))
   then return jsonb_build_object('ok',false,
     'code','finance_owner_withdrawal_rule_invalid'); end if;
   v_minimum:=nullif(v_rule.threshold_context->>'minimumMinor','')::numeric;
 end if;
 return jsonb_build_object('ok',true,'businessId',v_business,
   'shopId',p_shop_id,'accountId',p_account_id,
   'approvalRequired',v_rule.id is not null and
     (v_minimum is null or p_amount_minor::numeric>=v_minimum),
   'ruleId',v_rule.id);
end;
$preview$;
revoke all on function public.preview_admin_finance_owner_withdrawal_v1(
 uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.preview_admin_finance_owner_withdrawal_v1(
 uuid,uuid,uuid,bigint,text,text) to service_role;

create table private.admin_finance_owner_withdrawal_approval_receipts(
 approval_request_id uuid primary key
   references public.admin_approval_requests(id),
 business_id uuid not null,
 original_command_id text not null,
 receipt jsonb not null,
 created_at timestamptz not null default now(),
 unique(business_id,original_command_id)
);
alter table private.admin_finance_owner_withdrawal_approval_receipts
 enable row level security;
revoke all on private.admin_finance_owner_withdrawal_approval_receipts
 from public,anon,authenticated,service_role;

create or replace function public.execute_approved_admin_owner_withdrawal_v1(
 p_approval_request_id uuid,p_business_id uuid,p_shop_id uuid,
 p_requester_employee_id uuid,p_approver_employee_id uuid,
 p_account_id uuid,p_amount_minor bigint,p_reason text,
 p_original_command_id text,p_approval_command_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private
as $execute$
declare
 v_request public.admin_approval_requests%rowtype;
 v_receipt private.admin_finance_owner_withdrawal_approval_receipts%rowtype;
 v_expected jsonb;
 v_business uuid;
 v_allowed boolean;
 v_role text;
 v_approver_business uuid;
 v_result jsonb;
begin
 if p_approval_request_id is null or p_business_id is null or
    p_shop_id is null or p_account_id is null or
    p_requester_employee_id is null or p_approver_employee_id is null or
    p_requester_employee_id=p_approver_employee_id or
    p_approval_command_id is null or
    p_amount_minor is null or p_amount_minor not between 1 and 900000000000000 or
    p_reason is null or length(btrim(p_reason)) not between 1 and 500 or
    p_original_command_id is null or
    length(btrim(p_original_command_id)) not between 1 and 160
 then return jsonb_build_object('ok',false,'code','invalid_approved_owner_withdrawal'); end if;
 select * into v_request from public.admin_approval_requests
 where id=p_approval_request_id and business_id=p_business_id for update;
 v_expected:=jsonb_build_object('shopId',p_shop_id,
   'accountId',p_account_id,'amountMinor',p_amount_minor,
   'reason',btrim(p_reason),'commandId',p_original_command_id);
 if not found or v_request.shop_id is distinct from p_shop_id or
    v_request.action_type<>'FINANCE_OWNER_WITHDRAWAL' or
    v_request.requester_employee_id<>p_requester_employee_id or
    v_request.approver_employee_id is distinct from p_approver_employee_id or
    v_request.command_id is distinct from p_approval_command_id or
    v_request.command_payload<>v_expected or
    v_request.required_approver_permission<>'approvals.review' or
    not v_request.requires_second_person or
    v_request.status not in ('EXECUTING','EXECUTED')
 then return jsonb_build_object('ok',false,
   'code','approval_owner_withdrawal_payload_or_state_mismatch');end if;

 -- Actor authority and approver membership must still exist at execution.
 select a.business_id,a.authorized,a.employee_role
   into v_business,v_allowed,v_role
 from public.resolve_admin_authorization_v1(
   p_requester_employee_id,p_shop_id,'finance.adjust') a;
 select a.business_id into v_approver_business
 from public.resolve_admin_authorization_v1(
   p_approver_employee_id,p_shop_id,'approvals.review') a
 where a.authorized=true;
 if not coalesce(v_allowed,false) or v_business is distinct from p_business_id
    or coalesce(v_role,'') not in ('OWNER','ADMIN') or
    v_approver_business is distinct from p_business_id
 then return jsonb_build_object('ok',false,
   'code','approval_owner_withdrawal_permission_revoked');end if;
 select * into v_receipt
 from private.admin_finance_owner_withdrawal_approval_receipts
 where approval_request_id=p_approval_request_id for update;
 if found then
   if v_receipt.business_id<>p_business_id or
      v_receipt.original_command_id<>p_original_command_id
   then return jsonb_build_object('ok',false,
     'code','approval_owner_withdrawal_receipt_conflict');end if;
   return v_receipt.receipt||jsonb_build_object('idempotentReplay',true);
 end if;
 if v_request.status<>'EXECUTING' then
   return jsonb_build_object('ok',false,'code','approval_owner_withdrawal_not_claimed');end if;
 -- An approval cannot retroactively legitimize a movement posted before the
 -- request was claimed. The approved receipt is the ONLY replay authority.
 if exists(
   select 1 from private.finance_management_commands prior
   where prior.business_id=p_business_id
     and prior.command_id=p_original_command_id
 ) then
   return jsonb_build_object('ok',false,'code','approval_owner_withdrawal_already_posted');
 end if;
 perform set_config('tux.approved_owner_withdrawal_request_id',
   p_approval_request_id::text,true);
 v_result:=public.execute_finance_management_v1(
   p_requester_employee_id,p_shop_id,'OWNER_WITHDRAWAL',
   jsonb_build_object('fromAccountId',p_account_id,
     'amountMinor',p_amount_minor,'reason',btrim(p_reason)),
   p_original_command_id);
 perform set_config('tux.approved_owner_withdrawal_request_id','',true);
 if v_result->>'ok' is distinct from 'true' then return v_result;end if;
 insert into private.admin_finance_owner_withdrawal_approval_receipts(
   approval_request_id,business_id,original_command_id,receipt)
 values(p_approval_request_id,p_business_id,p_original_command_id,v_result);
 perform public.append_admin_audit_event_v1(
   p_business_id,p_shop_id,p_approver_employee_id,
   'FINANCE_OWNER_WITHDRAWAL_APPROVED_APPLIED',
   'FINANCE_COMMAND',p_original_command_id,
   null,jsonb_build_object('amountMinor',p_amount_minor,
     'accountId',p_account_id,'requestId',p_approval_request_id),
   btrim(p_reason),p_approval_request_id,null,
   jsonb_build_object('originalCommandId',p_original_command_id));
 return v_result;
end;
$execute$;
revoke all on function public.execute_approved_admin_owner_withdrawal_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.execute_approved_admin_owner_withdrawal_v1(
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid) to service_role;

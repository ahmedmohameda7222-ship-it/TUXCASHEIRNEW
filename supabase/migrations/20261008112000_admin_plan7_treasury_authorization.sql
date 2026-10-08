-- Plan 7 exact-head review hardening: restrict business-wide treasury and
-- owner capital actions without weakening ordinary shop finance.adjust.
create or replace function public.execute_finance_management_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_action text,p_payload jsonb,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
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
$$;
revoke all on function public.execute_finance_management_v1(uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.execute_finance_management_v1(uuid,uuid,text,jsonb,text)
  to service_role;

-- A shop-only finance configuration grant cannot map new operational receipts
-- into the global treasury without OWNER/ADMIN authority.
create or replace function public.set_payment_method_finance_account_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_payment_method_id uuid,
  p_finance_account_id uuid,
  p_expected_version bigint,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_business_id uuid;
  v_authorized boolean;
  v_account public.finance_accounts%rowtype;
  v_mapping public.payment_method_finance_accounts%rowtype;
  v_fingerprint text;
  v_receipt private.finance_setup_commands%rowtype;
  v_result jsonb;
  v_next_version bigint;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.manage_accounts'
  ) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_payment_method_id is null or p_expected_version is null
     or p_expected_version < 0
     or nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','finance_input_invalid');
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'actor',p_actor_employee_id,'shop',p_shop_id,'method',p_payment_method_id,
      'account',p_finance_account_id,'expectedVersion',p_expected_version
    )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(v_business_id::text||':finance-setup:'||p_command_id,0)
  );
  select * into v_receipt from private.finance_setup_commands
  where business_id=v_business_id and command_id=p_command_id;
  if found then
    if v_receipt.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok',false,'code','finance_command_conflict');
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;

  if not exists (
    select 1 from public.payment_methods pm
    where pm.shop_id=p_shop_id and pm.id=p_payment_method_id
  ) then
    return jsonb_build_object('ok',false,'code','finance_payment_method_forbidden');
  end if;
  if p_finance_account_id is not null then
    select * into v_account from public.finance_accounts
    where business_id=v_business_id and id=p_finance_account_id for update;
    if not found or not v_account.active
       or (v_account.shop_id is not null and v_account.shop_id <> p_shop_id) then
      return jsonb_build_object('ok',false,'code','finance_account_forbidden');
    end if;
    if v_account.shop_id is null and not exists (
      select 1 from public.business_employees e
      where e.id=p_actor_employee_id and e.business_id=v_business_id
        and e.active and e.role in ('OWNER','ADMIN')
    ) then
      return jsonb_build_object('ok',false,'code','permission_forbidden');
    end if;
  end if;

  select * into v_mapping
  from public.payment_method_finance_accounts
  where business_id=v_business_id and shop_id=p_shop_id
    and payment_method_id=p_payment_method_id for update;
  if found then
    if v_mapping.version <> p_expected_version then
      return jsonb_build_object('ok',false,'code','finance_mapping_version_conflict');
    end if;
    update public.payment_method_finance_accounts
    set finance_account_id=coalesce(p_finance_account_id,v_mapping.finance_account_id),
        active=(p_finance_account_id is not null),
        version=version+1,updated_at=now()
    where business_id=v_business_id and shop_id=p_shop_id
      and payment_method_id=p_payment_method_id;
    v_next_version := v_mapping.version+1;
  else
    if p_expected_version <> 0 then
      return jsonb_build_object('ok',false,'code','finance_mapping_version_conflict');
    end if;
    if p_finance_account_id is not null then
      insert into public.payment_method_finance_accounts(
        business_id,shop_id,payment_method_id,finance_account_id,active
      ) values(v_business_id,p_shop_id,p_payment_method_id,p_finance_account_id,true);
      v_next_version := 1;
    else
      v_next_version := 0; -- intentional no mapping, no fictional account
    end if;
  end if;

  perform public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_PAYMENT_MAPPING_CHANGED','PAYMENT_METHOD',p_payment_method_id::text,
    case when v_mapping.payment_method_id is null then null
         else jsonb_build_object('accountId',v_mapping.finance_account_id,
           'active',v_mapping.active,'version',v_mapping.version) end,
    jsonb_build_object('accountId',p_finance_account_id,
      'mapped',p_finance_account_id is not null,'version',v_next_version),
    'Finance payment method mapping updated',null,null,'{}'::jsonb
  );
  v_result := jsonb_build_object('ok',true,'replayed',false,
    'paymentMethodId',p_payment_method_id,'financeAccountId',p_finance_account_id,
    'mapped',p_finance_account_id is not null,'version',v_next_version);
  insert into private.finance_setup_commands(business_id,command_id,request_fingerprint,result)
  values(v_business_id,p_command_id,v_fingerprint,v_result);
  return v_result;
end;
$$;


revoke all on function public.set_payment_method_finance_account_v1(uuid,uuid,uuid,uuid,bigint,text)
  from public,anon,authenticated;
grant execute on function public.set_payment_method_finance_account_v1(uuid,uuid,uuid,uuid,bigint,text)
  to service_role;

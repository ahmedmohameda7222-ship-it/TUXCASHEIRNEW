-- Plan 7 management money operations. Transactional, permissioned, idempotent.
-- Operations retains exclusive authority over business-day open/close.
create table private.finance_management_commands (
  business_id uuid not null references public.businesses(id),
  command_id text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id, command_id)
);
revoke all on private.finance_management_commands from public, anon, authenticated;

create table public.admin_expense_finance_details (
  business_id uuid not null,
  shop_id uuid not null,
  expense_id uuid not null,
  category_id uuid,
  expense_date date not null,
  receipt_reference text,
  finance_account_id uuid,
  finance_movement_id uuid,
  created_at timestamptz not null default now(),
  primary key (shop_id, expense_id),
  constraint admin_expense_details_business_shop_fk
    foreign key (business_id,shop_id) references public.business_shops(business_id,shop_id),
  constraint admin_expense_details_expense_fk
    foreign key (shop_id,expense_id) references public.expenses(shop_id,id),
  constraint admin_expense_details_category_fk
    foreign key (business_id,category_id) references public.expense_categories(business_id,id),
  constraint admin_expense_details_account_fk
    foreign key (business_id,finance_account_id) references public.finance_accounts(business_id,id),
  constraint admin_expense_details_movement_fk
    foreign key (finance_movement_id) references public.finance_movements(id),
  constraint admin_expense_details_reference_check check (receipt_reference is null or length(receipt_reference) <= 600),
  constraint admin_expense_details_payment_consistency
    check ((finance_account_id is null) = (finance_movement_id is null))
);
alter table public.admin_expense_finance_details enable row level security;
revoke all on public.admin_expense_finance_details from public, anon, authenticated;
grant select, insert on public.admin_expense_finance_details to service_role;

create or replace function private.protect_admin_expense_history_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists (select 1 from public.admin_expense_finance_details e
             where e.shop_id=old.shop_id and e.expense_id=old.id) then
    raise exception using errcode='55000',message='TUX_ADMIN_POSTED_EXPENSE_IMMUTABLE';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger expenses_plan7_posted_immutable
before update or delete on public.expenses for each row
execute function private.protect_admin_expense_history_v1();
revoke all on function private.protect_admin_expense_history_v1() from public,anon,authenticated;

create or replace function public.execute_finance_management_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_action text,p_payload jsonb,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_business_id uuid;
  v_authorized boolean;
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
  select a.business_id,a.authorized into v_business_id,v_authorized
    from public.resolve_admin_authorization_v1(
      p_actor_employee_id,p_shop_id,v_permission) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
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

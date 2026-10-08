-- Plan 7 Finance setup: explicit account creation, deactivation, mapping.
-- Idempotent trusted RPCs; no inferred accounts and no opening-balance rewrites.

create table private.finance_setup_commands (
  business_id uuid not null references public.businesses(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id, command_id)
);
revoke all on private.finance_setup_commands from public, anon, authenticated;


create or replace function public.create_finance_account_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_scope_shop_id uuid,
  p_account_type text,
  p_name text,
  p_opening_balance_minor bigint,
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
  v_is_business_admin boolean;
  v_account_id uuid;
  v_fingerprint text;
  v_receipt private.finance_setup_commands%rowtype;
  v_result jsonb;
begin
  select a.business_id, a.authorized into v_business_id, v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.manage_accounts'
  ) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_scope_shop_id is not null and p_scope_shop_id <> p_shop_id then
    return jsonb_build_object('ok',false,'code','finance_scope_invalid');
  end if;
  select e.role in ('OWNER','ADMIN') into v_is_business_admin
  from public.business_employees e
  where e.id = p_actor_employee_id and e.business_id = v_business_id;
  if p_scope_shop_id is null and not coalesce(v_is_business_admin,false) then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_account_type not in ('CASH','BANK','WALLET','PENDING_SETTLEMENT')
     or nullif(btrim(p_name),'') is null
     or length(p_name) > 160
     or p_opening_balance_minor is null
     or nullif(btrim(p_command_id),'') is null
     or length(p_command_id) > 160 then
    return jsonb_build_object('ok',false,'code','finance_input_invalid');
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'actor',p_actor_employee_id,'shop',p_shop_id,'scopeShop',p_scope_shop_id,
      'type',p_account_type,'name',btrim(p_name),'opening',p_opening_balance_minor
    )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(v_business_id::text||':finance-setup:'||p_command_id,0)
  );
  select * into v_receipt
  from private.finance_setup_commands
  where business_id = v_business_id and command_id = p_command_id;
  if found then
    if v_receipt.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok',false,'code','finance_command_conflict');
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;

  insert into public.finance_accounts (
    business_id,shop_id,account_type,name,opening_balance_minor
  ) values (
    v_business_id,p_scope_shop_id,p_account_type,btrim(p_name),p_opening_balance_minor
  ) returning id into v_account_id;

  perform public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_ACCOUNT_CREATED','FINANCE_ACCOUNT',v_account_id::text,
    null,
    jsonb_build_object('name',btrim(p_name),'type',p_account_type,
      'scopeShopId',p_scope_shop_id,'openingBalanceMinor',p_opening_balance_minor),
    'Finance account created',null,null,'{}'::jsonb
  );

  v_result := jsonb_build_object(
    'ok',true,'replayed',false,'accountId',v_account_id,
    'businessId',v_business_id,'scopeShopId',p_scope_shop_id
  );
  insert into private.finance_setup_commands(
    business_id,command_id,request_fingerprint,result
  ) values(v_business_id,p_command_id,v_fingerprint,v_result);
  return v_result;
end;
$$;


create or replace function public.set_finance_account_active_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_account_id uuid,
  p_expected_version bigint,
  p_active boolean,
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
  v_fingerprint text;
  v_receipt private.finance_setup_commands%rowtype;
  v_result jsonb;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.manage_accounts'
  ) a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if p_active is null or p_expected_version is null or p_expected_version <= 0
     or nullif(btrim(p_command_id),'') is null or length(p_command_id) > 160 then
    return jsonb_build_object('ok',false,'code','finance_input_invalid');
  end if;

  v_fingerprint := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'actor',p_actor_employee_id,'shop',p_shop_id,'accountId',p_account_id,
      'expectedVersion',p_expected_version,'active',p_active
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

  select * into v_account from public.finance_accounts
  where business_id=v_business_id and id=p_account_id for update;
  if not found or (v_account.shop_id is not null and v_account.shop_id <> p_shop_id) then
    return jsonb_build_object('ok',false,'code','finance_account_forbidden');
  end if;
  if v_account.version <> p_expected_version then
    return jsonb_build_object('ok',false,'code','finance_account_version_conflict');
  end if;
  if v_account.shop_id is null and not exists (
    select 1 from public.business_employees e
    where e.id=p_actor_employee_id and e.business_id=v_business_id
      and e.role in ('OWNER','ADMIN')
  ) then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;

  if not p_active and exists (
    select 1 from public.payment_method_finance_accounts m
    where m.business_id=v_business_id
      and m.finance_account_id=v_account.id
      and m.active
  ) then
    return jsonb_build_object('ok',false,'code','finance_account_has_active_mapping');
  end if;

  update public.finance_accounts
  set active=p_active,version=version+1,updated_at=now()
  where id=v_account.id;

  perform public.append_admin_audit_event_v1(
    v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_ACCOUNT_STATUS_CHANGED','FINANCE_ACCOUNT',p_account_id::text,
    jsonb_build_object('active',v_account.active,'version',v_account.version),
    jsonb_build_object('active',p_active,'version',v_account.version+1),
    'Finance account status changed',null,null,'{}'::jsonb
  );
  v_result := jsonb_build_object('ok',true,'replayed',false,
    'accountId',p_account_id,'active',p_active,'version',v_account.version+1);
  insert into private.finance_setup_commands(business_id,command_id,request_fingerprint,result)
  values(v_business_id,p_command_id,v_fingerprint,v_result);
  return v_result;
end;
$$;


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

revoke all on function public.create_finance_account_v1(uuid,uuid,uuid,text,text,bigint,text)
  from public, anon, authenticated;
revoke all on function public.set_finance_account_active_v1(uuid,uuid,uuid,bigint,boolean,text)
  from public, anon, authenticated;
revoke all on function public.set_payment_method_finance_account_v1(uuid,uuid,uuid,uuid,bigint,text)
  from public, anon, authenticated;

grant execute on function public.create_finance_account_v1(uuid,uuid,uuid,text,text,bigint,text)
  to service_role;
grant execute on function public.set_finance_account_active_v1(uuid,uuid,uuid,bigint,boolean,text)
  to service_role;
grant execute on function public.set_payment_method_finance_account_v1(uuid,uuid,uuid,uuid,bigint,text)
  to service_role;

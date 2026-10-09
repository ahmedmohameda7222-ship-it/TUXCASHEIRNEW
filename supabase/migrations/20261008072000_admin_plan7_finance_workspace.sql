-- Plan 7: server-authoritative shop-scoped finance read model.
-- Never present invented account balances, payment mappings, or profit estimates.

create or replace function public.finance_workspace_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_authorized boolean;
  v_role text;
  v_result jsonb;
begin
  select a.business_id,a.authorized,a.employee_role
    into v_business_id,v_authorized,v_role
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.view'
  ) a;

  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;

  with permitted_accounts as (
    select a.id, a.shop_id, a.name, a.account_type, a.active,
      a.opening_balance_minor, a.version, a.business_id
    from public.finance_accounts a
    where a.business_id=v_business_id
      and (
        a.shop_id=p_shop_id
        or (a.shop_id is null and v_role in ('OWNER','ADMIN'))
      )
  ),
  account_totals as (
    select a.id,a.shop_id,a.name,a.account_type,a.active,
      a.opening_balance_minor,a.version,
      a.opening_balance_minor::numeric + coalesce(sum(m.amount_minor),0)::numeric
        as balance_minor
    from permitted_accounts a
    left join public.finance_movements m
      on m.business_id=a.business_id
     and m.finance_account_id=a.id
    group by a.id,a.shop_id,a.name,a.account_type,a.active,
      a.opening_balance_minor,a.version
  ),
  method_rows as (
    select pm.id,pm.display_name,pm.logic_type,pm.active,
      coalesce(map.version,0) as mapping_version,
      case when coalesce(map.active,false) and coalesce(acc.active,false)
        then map.finance_account_id
        else null::uuid
      end as account_id
    from public.payment_methods pm
    left join public.payment_method_finance_accounts map
      on map.business_id=v_business_id
     and map.shop_id=p_shop_id
     and map.payment_method_id=pm.id
    left join public.finance_accounts acc
      on acc.business_id=v_business_id and acc.id=map.finance_account_id
     and (acc.shop_id is null or acc.shop_id=p_shop_id)
    where pm.shop_id=p_shop_id and pm.active
  )
  select jsonb_build_object(
    'ok',true,
    'setupState',
      case when (select count(*) from account_totals)=0 then 'SETUP_REQUIRED'
        when (select count(*) from method_rows where account_id is null)>0
          then 'NEEDS_ATTENTION'
        else 'READY' end,
    'accounts',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'name',a.name,'shopId',a.shop_id,
        'accountType',a.account_type,'active',a.active,
        'openingBalanceMinor',a.opening_balance_minor,
        'balanceMinor',a.balance_minor,'version',a.version
      ) order by a.active desc,a.name,a.id) from account_totals a),'[]'::jsonb),
    'paymentMethods',
      coalesce((select jsonb_agg(jsonb_build_object(
        'id',m.id,'displayName',m.display_name,'logicType',m.logic_type,
        'financeAccountId',m.account_id,'mappingVersion',m.mapping_version
      ) order by m.display_name,m.id) from method_rows m),'[]'::jsonb),
    'unmappedPaymentMethodCount',
      (select count(*) from method_rows where account_id is null),
    'moneyPosition',
      case when (select count(*) from account_totals)=0 then null
        else (select jsonb_build_object(
          'totalTrackedMoneyMinor',coalesce(sum(a.balance_minor),0),
          'cashMinor',coalesce(sum(a.balance_minor) filter(where a.account_type='CASH'),0),
          'bankMinor',coalesce(sum(a.balance_minor) filter(where a.account_type='BANK'),0),
          'walletMinor',coalesce(sum(a.balance_minor) filter(where a.account_type='WALLET'),0),
          'pendingSettlementMinor',
            coalesce(sum(a.balance_minor) filter(where a.account_type='PENDING_SETTLEMENT'),0)
        ) from account_totals a) end,
    'profitSummary',null
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_workspace_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.finance_workspace_v1(uuid,uuid)
  to service_role;

-- Plan 7 classified X/Z facts. This migration is forward-only.
-- Preserve prior report calculation as base; the wrapper augments real immutable ledger facts.
alter function public.finance_day_report_v1(uuid,uuid,uuid)
  rename to finance_day_report_base_v1;

create function private.plan7_classified_movement_totals_v1(
 p_business_id uuid,p_shop_id uuid,p_business_day_id uuid
) returns jsonb language sql stable security definer
set search_path=pg_catalog,public,private as $$
with bounds as (
 select started_at, coalesce(ended_at,now()) as end_at
 from public.business_days
 where id=p_business_day_id and shop_id=p_shop_id
),
events as (
 select m.movement_type,m.amount_minor,a.account_type,
   m.command_id like 'plan7:%' and exists(
     select 1 from public.admin_audit_events ae
     where ae.business_id=m.business_id and ae.shop_id=m.shop_id
       and ae.action_type='FINANCE_BANK_DEPOSIT'
       and m.command_id='plan7:'||ae.entity_id
   ) as is_deposit
 from public.finance_movements m
 join public.finance_accounts a
   on a.id=m.finance_account_id and a.business_id=m.business_id
 cross join bounds d
 where m.business_id=p_business_id and m.shop_id=p_shop_id
   and m.created_at>=d.started_at and m.created_at<d.end_at
)
select jsonb_build_object(
 'openingFloatMinor',coalesce(sum(amount_minor) filter(
    where movement_type='OPENING_FLOAT' and account_type='CASH'),0),
 'cashPayInsMinor',coalesce(sum(amount_minor) filter(
    where movement_type='PAY_IN' and account_type='CASH'),0),
 'cashPayOutsMinor',coalesce(sum(-amount_minor) filter(
    where movement_type='PAY_OUT' and account_type='CASH'),0),
 'cashExpensesMinor',coalesce(sum(-amount_minor) filter(
    where movement_type='EXPENSE' and account_type='CASH'),0),
 'bankDepositsMinor',coalesce(sum(-amount_minor) filter(
    where movement_type='TRANSFER_OUT' and is_deposit),0),
 'transfersOutMinor',coalesce(sum(-amount_minor) filter(
    where movement_type='TRANSFER_OUT' and not is_deposit),0),
 'transfersInMinor',coalesce(sum(amount_minor) filter(
    where movement_type='TRANSFER_IN' and not is_deposit),0)
) from events;
$$;
revoke all on function private.plan7_classified_movement_totals_v1(uuid,uuid,uuid)
 from public,anon,authenticated;

create function public.finance_day_report_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_base jsonb; v_business uuid; v_ok boolean;
begin
 select a.business_id,a.authorized into v_business,v_ok
 from public.resolve_admin_authorization_v1(
   p_actor_employee_id,p_shop_id,'finance.view') a;
 if not coalesce(v_ok,false) or v_business is null then
   return jsonb_build_object('ok',false,'code','permission_forbidden');
 end if;
 v_base:=public.finance_day_report_base_v1(
   p_actor_employee_id,p_shop_id,p_business_day_id);
 if v_base->>'ok'<>'true' then return v_base; end if;
 return v_base || private.plan7_classified_movement_totals_v1(
   v_business,p_shop_id,p_business_day_id);
end;
$$;
revoke all on function public.finance_day_report_v1(uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.finance_day_report_v1(uuid,uuid,uuid)
 to service_role;

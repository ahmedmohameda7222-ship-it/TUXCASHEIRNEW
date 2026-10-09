-- Recognized per-cashier cash effects: do not infer an absent float.
create or replace function private.plan7_drawer_facts_v1(
 p_business_id uuid,p_shop_id uuid,p_business_day_id uuid,p_worker_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare v_day public.business_days%rowtype; v_sales bigint;v_refunds bigint;v_adjustments bigint;v_opening bigint;
begin
 select * into v_day from public.business_days d
 where d.id=p_business_day_id and d.shop_id=p_shop_id;
 if not found then return jsonb_build_object('ok',false); end if;
 select coalesce(sum(p.allocated_minor),0) into v_sales
 from public.payments p join public.orders o
 on o.id=p.order_id and o.shop_id=p.shop_id
 where o.shop_id=p_shop_id and o.business_day_id=p_business_day_id
 and o.operator_worker_id=p_worker_id and p.logic_type_snapshot='CASH';
 select coalesce(sum(r.amount_minor),0) into v_refunds
 from public.admin_order_refunds r
 join public.payments p on p.id=r.payment_id and p.shop_id=r.shop_id
 join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
 where r.business_id=p_business_id and r.state='POSTED'
 and r.shop_id=p_shop_id and o.business_day_id=p_business_day_id
 and o.operator_worker_id=p_worker_id and p.logic_type_snapshot='CASH';
 select coalesce(sum(fm.amount_minor),0),
 count(*) filter(where fm.movement_type='OPENING_FLOAT')
 into v_adjustments,v_opening
 from public.finance_movements fm
 join public.finance_accounts a on a.id=fm.finance_account_id and a.business_id=fm.business_id
 where fm.business_id=p_business_id and fm.shop_id=p_shop_id and
 fm.actor_worker_id=p_worker_id and a.account_type='CASH'
 and fm.movement_type not in ('SALE','REFUND')
 and fm.created_at>=v_day.started_at
 and fm.created_at<coalesce(v_day.ended_at,now());
 return jsonb_build_object('ok',true,
 'cashSalesExpectationMinor',v_sales-v_refunds,
 'recordedCashMovementMinor',v_adjustments,
 'openingFloatRecorded',v_opening>0,
 'recordedDrawerExpectationMinor',v_sales-v_refunds+v_adjustments);
end;$$;
revoke all on function private.plan7_drawer_facts_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.finance_reconcile_cashier_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid,
 p_cashier_worker_id uuid,p_actual_minor bigint,p_reason text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
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
$$;


-- Plan 7 expected cashier reconciliation and recurring expense definitions.
create or replace function public.finance_cashier_expectations_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_business_id uuid;v_authorized boolean;v_rows jsonb;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.view') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if not exists(select 1 from public.business_days d
    where d.id=p_business_day_id and d.shop_id=p_shop_id) then
    return jsonb_build_object('ok',false,'code','finance_day_not_found');
  end if;
  with receipts as (
    select o.operator_worker_id worker_id,
      sum(p.allocated_minor)::bigint cash_in
    from public.payments p
    join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
    where o.shop_id=p_shop_id and o.business_day_id=p_business_day_id
      and p.logic_type_snapshot='CASH'
    group by o.operator_worker_id
  ),
  refunded as (
    select o.operator_worker_id worker_id,sum(r.amount_minor)::bigint cash_out
    from public.admin_order_refunds r
    join public.payments p on p.id=r.payment_id and p.shop_id=r.shop_id
    join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
    where r.business_id=v_business_id and r.shop_id=p_shop_id
      and r.state='POSTED' and o.business_day_id=p_business_day_id
      and p.logic_type_snapshot='CASH'
    group by o.operator_worker_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'cashierWorkerId',w.id,'displayName',w.display_name,
    'cashCollectedMinor',coalesce(rc.cash_in,0),
    'postedCashRefundsMinor',coalesce(rf.cash_out,0),
    'expectedMinor',(d.facts->>'recordedDrawerExpectationMinor')::bigint,
    'cashSalesExpectationMinor',d.facts->'cashSalesExpectationMinor',
    'recordedCashMovementMinor',d.facts->'recordedCashMovementMinor',
    'openingFloatRecorded',d.facts->'openingFloatRecorded',
    'actualMinor',rec.actual_minor,
    'varianceMinor',rec.variance_minor,
    'reconciled',rec.id is not null
  ) order by w.display_name,w.id),'[]'::jsonb) into v_rows
  from public.workers w
  left join receipts rc on rc.worker_id=w.id
  left join refunded rf on rf.worker_id=w.id
  left join public.cashier_reconciliations rec
    on rec.shop_id=p_shop_id and rec.business_day_id=p_business_day_id
       and rec.cashier_worker_id=w.id
  cross join lateral (select private.plan7_drawer_facts_v1(v_business_id,p_shop_id,p_business_day_id,w.id) facts) d
  where w.shop_id=p_shop_id and
  (coalesce(rc.cash_in,0)<>0 or coalesce(rf.cash_out,0)<>0 or
   (d.facts->>'recordedCashMovementMinor')::bigint<>0 or rec.id is not null);
  return jsonb_build_object('ok',true,'cashiers',v_rows);
end;
$$;


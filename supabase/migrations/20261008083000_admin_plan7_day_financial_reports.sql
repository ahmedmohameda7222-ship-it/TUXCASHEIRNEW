-- Plan 7 X and financial-Z. Operations closes business_days; Admin NEVER does.
alter table public.cashier_reconciliations
  add column command_id text,
  add column request_fingerprint text,
  add constraint cashier_reconciliations_fingerprint_ck
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$');
create unique index cashier_reconciliations_command_uniq
  on public.cashier_reconciliations(business_id,command_id)
  where command_id is not null;

create or replace function public.finance_day_report_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_business_id uuid;
  v_authorized boolean;
  v_day public.business_days%rowtype;
  v_orders bigint;
  v_gross bigint;
  v_discounts bigint;
  v_tax bigint;
  v_service bigint;
  v_delivery bigint;
  v_pos bigint;
  v_online bigint;
  v_allocated bigint;
  v_refunds bigint;
  v_cash bigint;
  v_cash_refunds bigint;
  v_expenses bigint;
  v_staff_expenses bigint;
  v_cogs bigint;
  v_missing bigint;
  v_waste bigint;
  v_unmapped bigint;
  v_adjustments bigint;
  v_breakdown jsonb;
  v_reconciliations jsonb;
  v_recon_missing bigint;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.view') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  select * into v_day from public.business_days
  where shop_id=p_shop_id and id=p_business_day_id;
  if not found then return jsonb_build_object('ok',false,'code','finance_day_not_found'); end if;

  select count(*),coalesce(sum(o.total_minor),0),coalesce(sum(o.discount_minor),0),
    coalesce(sum(o.tax_minor),0),coalesce(sum(o.service_charge_minor),0),
    coalesce(sum(o.final_delivery_fee_minor),0),
    count(*) filter(where o.source='POS'),
    count(*) filter(where o.source='ONLINE')
  into v_orders,v_gross,v_discounts,v_tax,v_service,v_delivery,v_pos,v_online
  from public.orders o where o.shop_id=p_shop_id and o.business_day_id=v_day.id;

  select coalesce(sum(p.allocated_minor),0),
    coalesce(sum(p.allocated_minor) filter(where p.logic_type_snapshot='CASH'),0)
  into v_allocated,v_cash
  from public.payments p join public.orders o
    on o.shop_id=p.shop_id and o.id=p.order_id
  where o.shop_id=p_shop_id and o.business_day_id=v_day.id;

  select coalesce(sum(r.amount_minor),0),
    coalesce(sum(r.amount_minor) filter(where p.logic_type_snapshot='CASH'),0)
  into v_refunds,v_cash_refunds
  from public.admin_order_refunds r
  join public.orders o on o.id=r.order_id and o.shop_id=r.shop_id
  join public.payments p on p.id=r.payment_id and p.shop_id=r.shop_id
  where r.business_id=v_business_id and r.shop_id=p_shop_id
    and o.business_day_id=v_day.id and r.state='POSTED';

  select coalesce(sum(e.amount_minor),0) into v_expenses
  from public.expenses e
  where e.shop_id=p_shop_id and e.business_day_id=v_day.id
    and e.kind='MANUAL' and e.deleted_at is null;

  select coalesce(sum(s.paid_amount_minor),0) into v_staff_expenses
  from public.staff_payment_expense_events s
  where s.business_id=v_business_id and s.shop_id=p_shop_id
    and s.created_at>=v_day.started_at
    and s.created_at<coalesce(v_day.ended_at,now());

  select count(*) filter(where m.unit_cost_minor is null),
    coalesce(round(sum(-m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000)),0)::bigint,
    coalesce(round(sum(
      case when m.movement_type='WASTE'
        then -m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000
        else 0 end
    )),0)::bigint
  into v_missing,v_cogs,v_waste
  from public.inventory_movements m
  where m.shop_id=p_shop_id and m.business_day_id=v_day.id
    and m.movement_type in ('ORDER_CONSUMPTION','ORDER_CONSUMPTION_REVERSAL','WASTE');
  -- Waste is an expense-like exception, not consumption COGS.
  select coalesce(round(sum(-m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000)),0)::bigint
  into v_cogs from public.inventory_movements m
  where m.shop_id=p_shop_id and m.business_day_id=v_day.id
    and m.movement_type in ('ORDER_CONSUMPTION','ORDER_CONSUMPTION_REVERSAL');

  select count(*) into v_unmapped
  from public.payments p
  join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
  where o.shop_id=p_shop_id and o.business_day_id=v_day.id
    and p.allocated_minor>0 and not exists(
      select 1 from public.finance_movements fm
      where fm.business_id=v_business_id and fm.shop_id=p_shop_id
        and fm.source_kind='PAYMENT' and fm.source_id=p.id::text
        and fm.source_effect='SALE');

  select coalesce(jsonb_object_agg(label,minor), '{}'::jsonb)
  into v_breakdown from (
    select p.payment_method_label_snapshot as label,
      sum(p.allocated_minor)::bigint as minor
    from public.payments p join public.orders o
      on o.id=p.order_id and o.shop_id=p.shop_id
    where o.shop_id=p_shop_id and o.business_day_id=v_day.id
    group by p.payment_method_label_snapshot
  ) breakdown;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cashierWorkerId',r.cashier_worker_id,
    'expectedMinor',r.expected_minor,'actualMinor',r.actual_minor,
    'varianceMinor',r.variance_minor,'reason',r.variance_reason,
    'postedAt',r.posted_at) order by r.posted_at,r.id),'[]'::jsonb)
  into v_reconciliations from public.cashier_reconciliations r
  where r.business_id=v_business_id and r.shop_id=p_shop_id
    and r.business_day_id=v_day.id;

  select count(distinct o.operator_worker_id) into v_recon_missing
  from public.payments p join public.orders o
    on o.id=p.order_id and o.shop_id=p.shop_id
  where o.shop_id=p_shop_id and o.business_day_id=v_day.id
    and p.logic_type_snapshot='CASH' and p.allocated_minor>0
    and not exists(
      select 1 from public.cashier_reconciliations r
      where r.shop_id=p_shop_id and r.business_day_id=v_day.id
        and r.cashier_worker_id=o.operator_worker_id);

  select coalesce(sum(a.amount_minor),0) into v_adjustments
  from public.financial_adjustments a
  join public.end_day_financial_snapshots z on z.id=a.snapshot_id
  where z.business_id=v_business_id and z.shop_id=p_shop_id
    and z.business_day_id=v_day.id;

  return jsonb_build_object(
    'ok',true,'reportKind','X','shopId',p_shop_id,'businessDayId',v_day.id,
    'businessDayStatus',v_day.status,'startedAt',v_day.started_at,
    'endedAt',v_day.ended_at,'orderCount',v_orders,
    'grossOrderTotalMinor',v_gross,'discountMinor',v_discounts,
    'taxMinor',v_tax,'serviceChargeMinor',v_service,
    'deliveryFeeMinor',v_delivery,'posOrderCount',v_pos,
    'onlineOrderCount',v_online,'allocatedPaymentsMinor',v_allocated,
    'postedRefundsMinor',v_refunds,'netSalesMinor',v_allocated-v_refunds,
    'cashPaymentsMinor',v_cash,'cashRefundsMinor',v_cash_refunds,
    'cashSalesNetMinor',v_cash-v_cash_refunds,
    'operatingExpensesMinor',v_expenses,'staffPaymentsMinor',v_staff_expenses,
    'totalExpensesMinor',v_expenses+v_staff_expenses,
    'cogsMinor',case when v_missing>0 then null else v_cogs end,
    'estimatedOperatingProfitMinor',
       case when v_missing>0 then null
         else v_allocated-v_refunds-v_cogs-v_expenses-v_staff_expenses end,
    'wasteCostMinor',v_waste,'missingInventoryCostCount',v_missing,
    'unattributedPaymentCount',v_unmapped,
    'paymentBreakdown',v_breakdown,'cashierReconciliations',v_reconciliations,
    'missingCashierReconciliationCount',v_recon_missing,
    'postFinalizationAdjustmentsMinor',v_adjustments,
    'financialFinalized',exists(
      select 1 from public.end_day_financial_snapshots z
      where z.business_id=v_business_id and z.shop_id=p_shop_id
        and z.business_day_id=v_day.id)
  );
end;
$$;

-- Records a posted count against server-computed cashier cash sales; never
-- accepts client-supplied expected totals. Operations day status is read-only.
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
  select coalesce(sum(p.allocated_minor),0) into v_expected
  from public.payments p join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
  where o.shop_id=p_shop_id and o.business_day_id=p_business_day_id
    and o.operator_worker_id=p_cashier_worker_id
    and p.logic_type_snapshot='CASH';
  select v_expected-coalesce(sum(r.amount_minor),0) into v_expected
  from public.admin_order_refunds r
  join public.payments p on p.id=r.payment_id and p.shop_id=r.shop_id
  join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
  where o.shop_id=p_shop_id and o.business_day_id=p_business_day_id
    and o.operator_worker_id=p_cashier_worker_id
    and p.logic_type_snapshot='CASH' and r.state='POSTED';
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
    'actualMinor',p_actual_minor,'varianceMinor',p_actual_minor-v_expected);
end;
$$;

create or replace function public.finance_finalize_day_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_business_day_id uuid,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_business_id uuid; v_authorized boolean;
  v_day public.business_days%rowtype;
  v_existing public.end_day_financial_snapshots%rowtype;
  v_report jsonb; v_hash text; v_id uuid;
begin
  select a.business_id,a.authorized into v_business_id,v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id,p_shop_id,'finance.reconcile') a;
  if not coalesce(v_authorized,false) or v_business_id is null then
    return jsonb_build_object('ok',false,'code','permission_forbidden');
  end if;
  if nullif(btrim(p_command_id),'') is null or length(p_command_id)>160 then
    return jsonb_build_object('ok',false,'code','finance_command_invalid');
  end if;
  select * into v_day from public.business_days
    where id=p_business_day_id and shop_id=p_shop_id for update;
  if not found or v_day.status<>'CLOSED' then
    return jsonb_build_object('ok',false,'code','finance_day_must_be_closed');
  end if;
  select * into v_existing from public.end_day_financial_snapshots
    where business_id=v_business_id and shop_id=p_shop_id
      and business_day_id=p_business_day_id for update;
  if found then
    if v_existing.finalization_command_id=p_command_id
       and v_existing.finalized_by_employee_id=p_actor_employee_id then
      return jsonb_build_object('ok',true,'replayed',true,'snapshotId',v_existing.id);
    end if;
    return jsonb_build_object('ok',false,'code','finance_day_already_finalized');
  end if;
  v_report:=public.finance_day_report_v1(p_actor_employee_id,p_shop_id,p_business_day_id);
  if v_report->>'ok'<>'true' then return v_report; end if;
  if coalesce((v_report->>'missingCashierReconciliationCount')::bigint,0)>0 then
    return jsonb_build_object('ok',false,'code','finance_cashiers_not_reconciled');
  end if;
  if coalesce((v_report->>'missingInventoryCostCount')::bigint,0)>0 then
    return jsonb_build_object('ok',false,'code','finance_cogs_incomplete');
  end if;
  if coalesce((v_report->>'unattributedPaymentCount')::bigint,0)>0 then
    return jsonb_build_object('ok',false,'code','finance_unattributed_payments');
  end if;
  v_hash:=encode(extensions.digest(convert_to(v_report::text,'UTF8'),'sha256'),'hex');
  insert into public.end_day_financial_snapshots(
    business_id,shop_id,business_day_id,snapshot,request_fingerprint,
    finalization_command_id,finalized_by_employee_id)
  values(v_business_id,p_shop_id,p_business_day_id,
    v_report||jsonb_build_object('reportKind','Z','financialStatus','FINALIZED'),
    v_hash,p_command_id,p_actor_employee_id)
  returning id into v_id;
  perform public.append_admin_audit_event_v1(v_business_id,p_shop_id,p_actor_employee_id,
    'FINANCE_DAY_FINALIZED','BUSINESS_DAY',p_business_day_id::text,
    null,jsonb_build_object('snapshotId',v_id,'hash',v_hash),
    'Financial day finalized (Operations already closed)',null,null,'{}'::jsonb);
  return jsonb_build_object('ok',true,'replayed',false,
    'snapshotId',v_id,'businessDayId',p_business_day_id);
end;
$$;

create or replace function public.finance_adjust_snapshot_v1(
 p_actor_employee_id uuid,p_shop_id uuid,p_snapshot_id uuid,
 p_amount_minor bigint,p_reason text,p_command_id text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private,extensions as $$
declare
  v_business_id uuid; v_authorized boolean;
  v_existing public.financial_adjustments%rowtype;
  v_id uuid;
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
  if not exists(select 1 from public.end_day_financial_snapshots z
      where z.id=p_snapshot_id and z.business_id=v_business_id and z.shop_id=p_shop_id) then
    return jsonb_build_object('ok',false,'code','finance_snapshot_not_found');
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
$$;
revoke all on function public.finance_day_report_v1(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finance_reconcile_cashier_v1(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.finance_finalize_day_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finance_adjust_snapshot_v1(uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.finance_day_report_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.finance_reconcile_cashier_v1(uuid,uuid,uuid,uuid,bigint,text,text) to service_role;
grant execute on function public.finance_finalize_day_v1(uuid,uuid,uuid,text) to service_role;
grant execute on function public.finance_adjust_snapshot_v1(uuid,uuid,uuid,bigint,text,text) to service_role;

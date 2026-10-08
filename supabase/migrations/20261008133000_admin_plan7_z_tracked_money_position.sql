-- Freeze only shop-scoped, real ledger accounts. Shared business treasury is not apportioned.
create or replace function private.plan7_shop_money_at_day_v1(p_business_id uuid,p_shop_id uuid,p_day_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare v_end timestamptz;v_start timestamptz;v_data jsonb;
begin
 select d.started_at,coalesce(d.ended_at,now()) into v_start,v_end
 from public.business_days d where d.shop_id=p_shop_id and d.id=p_day_id;
 if not found then return '{}'::jsonb; end if;
 with account_balances as (
   select a.id,a.account_type,
     a.opening_balance_minor::numeric+coalesce(sum(m.amount_minor),0)::numeric balance
   from public.finance_accounts a
   left join public.finance_movements m
      on m.business_id=p_business_id and m.finance_account_id=a.id
      and m.created_at<=v_end
   where a.business_id=p_business_id and a.shop_id=p_shop_id and a.created_at<=v_end
   group by a.id,a.account_type,a.opening_balance_minor
 )
 select jsonb_build_object(
   'moneyPositionScope','SHOP_TRACKED_ACCOUNTS_ONLY',
   'closingCashMinor',sum(balance) filter(where account_type='CASH'),
   'closingBankMinor',sum(balance) filter(where account_type='BANK'),
   'closingWalletMinor',sum(balance) filter(where account_type='WALLET'),
   'closingPendingSettlementMinor',sum(balance) filter(where account_type='PENDING_SETTLEMENT'),
   'closingTrackedFundsMinor',sum(balance))
 into v_data from account_balances;
 return v_data;
end;$$;
revoke all on function private.plan7_shop_money_at_day_v1(uuid,uuid,uuid)
 from public,anon,authenticated;

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
  v_bank_fees bigint;
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

  -- Provider fees are expenses, not transfers. Recognize fees on ledger posting
  -- within the business-day window without rewriting settled money movements.
  select coalesce(sum(-fm.amount_minor),0)::bigint into v_bank_fees
  from public.finance_movements fm
  where fm.business_id=v_business_id and fm.shop_id=p_shop_id
    and fm.movement_type='BANK_FEE'
    and fm.created_at>=v_day.started_at
    and fm.created_at<coalesce(v_day.ended_at,now());

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
    'operatingExpensesMinor',v_expenses+v_bank_fees,
    'manualExpensesMinor',v_expenses,'staffPaymentsMinor',v_staff_expenses,
    'bankFeesMinor',v_bank_fees,
    'totalExpensesMinor',v_expenses+v_staff_expenses+v_bank_fees,
    'cogsMinor',case when v_missing>0 then null else v_cogs end,
    'estimatedOperatingProfitMinor',
       case when v_missing>0 then null
         else v_allocated-v_refunds-v_cogs-v_expenses-v_staff_expenses-v_bank_fees end,
    'wasteCostMinor',v_waste,'missingInventoryCostCount',v_missing,
    'unattributedPaymentCount',v_unmapped,
    'paymentBreakdown',v_breakdown,'cashierReconciliations',v_reconciliations,
    'missingCashierReconciliationCount',v_recon_missing,
    'postFinalizationAdjustmentsMinor',v_adjustments,
    'financialFinalized',exists(
      select 1 from public.end_day_financial_snapshots z
      where z.business_id=v_business_id and z.shop_id=p_shop_id
        and z.business_day_id=v_day.id)
  ) || private.plan7_shop_money_at_day_v1(v_business_id,p_shop_id,v_day.id);
end;
$;


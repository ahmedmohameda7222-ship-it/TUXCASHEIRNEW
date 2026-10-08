-- Plan 7 authoritative paginated reporting; facts remain in their canonical tables.
-- Currency in integer minor units; business date uses Africa/Cairo.
create or replace function public.admin_finance_report_query_v1(
  p_actor_employee_id uuid,
  p_shop_ids uuid[],
  p_area text,
  p_start_date date,
  p_end_date date,
  p_page_limit integer default 50,
  p_offset integer default 0,
  p_source text default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_business_id uuid;
  v_shop_id uuid;
  v_authorized boolean;
  v_subject jsonb;
  v_rows jsonb;
  v_summary jsonb;
  v_area text:=p_area;
begin
  if p_shop_ids is null or cardinality(p_shop_ids)=0 or cardinality(p_shop_ids)>50
    or (select count(distinct x) from unnest(p_shop_ids) x)<>cardinality(p_shop_ids)
    or p_start_date is null or p_end_date is null
    or p_end_date<p_start_date or p_end_date-p_start_date>730
    or p_page_limit not between 1 and 100 or p_offset not between 0 and 20000
    or (p_source is not null and p_source not in ('POS','ONLINE'))
    or v_area not in ('sales','profit','products','inventory-consumption',
      'waste','theoretical-variance','margin-variance','purchasing',
      'customers','payments','expenses','staff','delivery','refunds',
      'tax','end-day','bank-cash','shop-comparison') then
    return jsonb_build_object('ok',false,'code','report_filters_invalid');
  end if;

  foreach v_shop_id in array p_shop_ids loop
    select a.business_id,a.authorized into v_business_id,v_authorized
    from public.resolve_admin_authorization_v1(
      p_actor_employee_id,v_shop_id,'reports.view') a;
    if not coalesce(v_authorized,false) or v_business_id is null then
      return jsonb_build_object('ok',false,'code','permission_forbidden');
    end if;
  end loop;

  with facts as (
    select p.id::text source_id,p.shop_id,o.created_at occurred_at,
      'payment'::text source_kind,p.payment_method_label_snapshot label,
      p.allocated_minor::numeric amount_minor,1::bigint quantity,
      o.source order_source,false cost_missing
    from public.payments p
    join public.orders o on o.id=p.order_id and o.shop_id=p.shop_id
    where v_area in ('sales','profit','payments','shop-comparison')
      and p.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
    union all
    select r.id::text,r.shop_id,r.created_at,
      'refund',r.reason_label_snapshot,
      -r.amount_minor::numeric,-1::bigint,o.source,false
    from public.admin_order_refunds r
    join public.orders o on o.id=r.order_id and o.shop_id=r.shop_id
    where v_area in ('sales','profit','refunds','shop-comparison')
      and r.business_id=v_business_id and r.shop_id=any(p_shop_ids)
      and r.state='POSTED' and (p_source is null or o.source=p_source)
    union all
    select oi.id::text,oi.shop_id,o.created_at,'order-item',
      oi.product_name_snapshot,
      (oi.unit_price_minor::numeric*oi.quantity),oi.quantity::bigint,
      o.source,false
    from public.order_items oi
    join public.orders o on o.id=oi.order_id and o.shop_id=oi.shop_id
    where v_area='products' and oi.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
    union all
    select m.id::text,m.shop_id,m.created_at,'inventory-movement',
      coalesce(i.name,m.movement_type),
      case when m.unit_cost_minor is not null then
        round(-m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000)
        else null::numeric end,
      m.quantity_delta_micros::bigint,null::text,
      m.unit_cost_minor is null
    from public.inventory_movements m
    left join public.inventory_items i on i.id=m.inventory_item_id
      and i.shop_id=m.shop_id
    where m.shop_id=any(p_shop_ids)
      and ((v_area in ('inventory-consumption','profit')
             and m.movement_type in ('ORDER_CONSUMPTION','ORDER_CONSUMPTION_REVERSAL'))
        or (v_area='waste' and m.movement_type='WASTE')
        or (v_area='theoretical-variance'
             and m.movement_type in ('STOCKTAKE_ADJUSTMENT','ADMIN_ADJUSTMENT'))
        or (v_area='margin-variance'
             and m.movement_type in ('ORDER_CONSUMPTION','ORDER_CONSUMPTION_REVERSAL')))
    union all
    select po.id::text,po.shop_id,po.created_at,'purchase-order',
      coalesce(po.reference,po.status),null::numeric,1::bigint,null::text,true
    from public.purchase_orders po
    where v_area='purchasing' and po.business_id=v_business_id
      and po.shop_id=any(p_shop_ids)
    union all
    select o.id::text,o.shop_id,o.created_at,'customer-order',
      coalesce(o.customer_name_snapshot,'Customer order'),
      o.total_minor::numeric,1::bigint,o.source,false
    from public.orders o where v_area='customers' and o.shop_id=any(p_shop_ids)
      and o.customer_contact_id is not null
      and (p_source is null or o.source=p_source)
    union all
    select o.id::text,o.shop_id,o.created_at,'delivery-order',
      coalesce(o.delivery_zone_label_snapshot,'Delivery'),
      o.final_delivery_fee_minor::numeric,1::bigint,o.source,false
    from public.orders o where v_area='delivery' and o.shop_id=any(p_shop_ids)
      and o.order_type_behavior_snapshot='DELIVERY'
      and (p_source is null or o.source=p_source)
    union all
    select o.id::text,o.shop_id,o.created_at,'tax-service',
      'Tax and service charge',
      (o.tax_minor+o.service_charge_minor)::numeric,1::bigint,o.source,false
    from public.orders o where v_area='tax' and o.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
    union all
    select e.id::text,e.shop_id,e.created_at,'expense',
      e.description,(-e.amount_minor)::numeric,1::bigint,null::text,false
    from public.expenses e
    where v_area in ('expenses','profit') and e.shop_id=any(p_shop_ids)
      and e.kind='MANUAL' and e.deleted_at is null
    union all
    select sp.staff_payment_record_id::text,sp.shop_id,sp.created_at,
      'staff-payment','Staff payment',
      -sp.paid_amount_minor::numeric,1::bigint,null::text,false
    from public.staff_payment_expense_events sp
    where v_area in ('expenses','staff','profit')
      and sp.business_id=v_business_id and sp.shop_id=any(p_shop_ids)
    union all
    select fm.id::text,fm.shop_id,fm.created_at,'finance-movement',
      fm.movement_type,fm.amount_minor::numeric,1::bigint,null::text,false
    from public.finance_movements fm
    where v_area='bank-cash' and fm.business_id=v_business_id
      and fm.shop_id=any(p_shop_ids)
    union all
    select z.id::text,z.shop_id,z.finalized_at,'financial-z',
      'Finalized Z',nullif(z.snapshot->>'estimatedOperatingProfitMinor','')::numeric,
      1::bigint,null::text,
      (z.snapshot->>'estimatedOperatingProfitMinor') is null
    from public.end_day_financial_snapshots z
    where v_area='end-day' and z.business_id=v_business_id
      and z.shop_id=any(p_shop_ids)
  ),
  scoped as (
    select f.* from facts f
    where ((f.occurred_at at time zone 'Africa/Cairo')::date
      between p_start_date and p_end_date)
  ),
  aggregate as (
    select count(*) event_count,coalesce(sum(amount_minor),0) total_minor,
      count(*) filter(where cost_missing) incomplete_cost_events,
      coalesce(sum(quantity),0) total_quantity
    from scoped
  ),
  page as (
    select f.source_id,f.shop_id,f.occurred_at,f.source_kind,f.label,
      f.amount_minor,f.quantity,f.order_source,f.cost_missing
    from scoped f
    order by f.occurred_at desc,f.source_id desc
    limit p_page_limit offset p_offset
  )
  select
    jsonb_build_object(
      'eventCount',a.event_count,'totalAmountMinor',
        case when a.incomplete_cost_events>0
          and v_area in ('profit','inventory-consumption','waste','margin-variance')
          then null else a.total_minor end,
      'totalQuantity',a.total_quantity,'incompleteCostEvents',a.incomplete_cost_events,
      'coverageNote',
        case when v_area='margin-variance' then
          'Recorded inventory cost movements only; theoretical margin baseline unavailable'
        when v_area='theoretical-variance' then
          'Stocktake/adjustment movements, not inferred theoretical usage'
        when v_area='purchasing' then
          'Order count only; received cost requires authoritative receipt valuation'
        else null end),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.source_id,'shopId',p.shop_id,'occurredAt',p.occurred_at,
      'sourceKind',p.source_kind,'label',p.label,
      'amountMinor',p.amount_minor,'quantity',p.quantity,
      'orderSource',p.order_source,'costMissing',p.cost_missing)
      order by p.occurred_at desc,p.source_id desc) from page p),'[]'::jsonb)
  into v_summary,v_rows from aggregate a;

  return jsonb_build_object('ok',true,'area',v_area,
    'fromDate',p_start_date,'toDate',p_end_date,
    'shopIds',p_shop_ids,'source',p_source,
    'summary',v_summary,'rows',v_rows,
    'nextOffset',case when jsonb_array_length(v_rows)=p_page_limit
      then p_offset+p_page_limit else null end);
end;
$$;
revoke all on function public.admin_finance_report_query_v1(uuid,uuid[],text,date,date,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.admin_finance_report_query_v1(uuid,uuid[],text,date,date,integer,integer,text)
  to service_role;

-- Plan 7 context report filters; caller-supplied IDs only authorize existing canonical source rows.
-- Filter an order using trusted canonical references; never filter only the paginated rows.
create or replace function private.plan7_report_order_context_v1(
  p_shop_id uuid,p_order_id uuid,p_context jsonb
) returns boolean language sql stable security definer
set search_path=pg_catalog,public,private
as $$
select exists (
 select 1 from public.orders o where o.shop_id=p_shop_id and o.id=p_order_id
 and (p_context->>'orderTypeId' is null or o.order_type_id::text=p_context->>'orderTypeId')
 and (p_context->>'workerId' is null or o.operator_worker_id::text=p_context->>'workerId')
 and (p_context->>'customerId' is null or o.customer_contact_id::text=p_context->>'customerId')
 and (p_context->>'deliveryZoneId' is null or o.delivery_zone_id::text=p_context->>'deliveryZoneId')
 and (p_context->>'status' is null or o.status=p_context->>'status')
 and (p_context->>'paymentMethodId' is null or exists (
   select 1 from public.payments p where p.shop_id=o.shop_id and p.order_id=o.id
   and p.payment_method_id::text=p_context->>'paymentMethodId'
 ))
 and ((p_context->>'productId' is null and p_context->>'categoryId' is null) or exists (
   select 1 from public.order_items oi
   left join public.products prod on prod.id=oi.product_id and prod.shop_id=oi.shop_id
   where oi.shop_id=o.shop_id and oi.order_id=o.id
   and (p_context->>'productId' is null or oi.product_id::text=p_context->>'productId')
   and (p_context->>'categoryId' is null or prod.category_id::text=p_context->>'categoryId')
 ))
 and (p_context->>'promotionId' is null or exists (
   select 1 from public.promotion_usage_ledger u where u.shop_id=o.shop_id and u.order_id=o.id
   and u.promotion_id::text=p_context->>'promotionId'
 ))
 and p_context->>'supplierId' is null
 and p_context->>'employeeId' is null
)
$$;
revoke all on function private.plan7_report_order_context_v1(uuid,uuid,jsonb)
  from public,anon,authenticated;

create or replace function public.admin_finance_report_query_v2(
  p_actor_employee_id uuid,
  p_shop_ids uuid[],
  p_area text,
  p_start_date date,
  p_end_date date,
  p_page_limit integer,
  p_offset integer,
  p_source text,
  p_context jsonb
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
      'tax','end-day','bank-cash','shop-comparison',
      'loyalty','promotions','segments','attendance') then
    return jsonb_build_object('ok',false,'code','report_filters_invalid');
  end if;

  if p_context is null or jsonb_typeof(p_context)<>'object'
      or exists (select 1 from jsonb_object_keys(p_context) k where k not in
        ('orderTypeId','paymentMethodId','workerId','employeeId','customerId',
         'productId','categoryId','promotionId','supplierId','deliveryZoneId','status'))
      or (p_context<>'{}'::jsonb and v_area not in
        ('sales','payments','products','customers','delivery','tax','refunds',
         'shop-comparison','loyalty','promotions','purchasing','staff','attendance','segments'))
      or (v_area='purchasing' and (p_context - 'supplierId' - 'status') <> '{}'::jsonb)
      or (v_area in ('staff','attendance') and
           (p_context - 'workerId' - 'employeeId' - 'status') <> '{}'::jsonb)
      or (v_area='segments' and (p_context - 'customerId') <> '{}'::jsonb)
  then return jsonb_build_object('ok',false,'code','report_context_invalid'); end if;

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
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
      and (p_context->>'paymentMethodId' is null or p.payment_method_id::text=p_context->>'paymentMethodId')
    union all
    select r.id::text,r.shop_id,r.created_at,
      'refund',r.reason_label_snapshot,
      -r.amount_minor::numeric,-1::bigint,o.source,false
    from public.admin_order_refunds r
    join public.orders o on o.id=r.order_id and o.shop_id=r.shop_id
    where v_area in ('sales','profit','refunds','shop-comparison')
      and r.business_id=v_business_id and r.shop_id=any(p_shop_ids)
      and r.state='POSTED' and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
      and (p_context->>'paymentMethodId' is null or r.payment_id in
        (select pay.id from public.payments pay where pay.shop_id=r.shop_id
           and pay.payment_method_id::text=p_context->>'paymentMethodId'))
    union all
    select oi.id::text,oi.shop_id,o.created_at,'order-item',
      oi.product_name_snapshot,
      (oi.unit_price_minor::numeric*oi.quantity),oi.quantity::bigint,
      o.source,false
    from public.order_items oi
    join public.orders o on o.id=oi.order_id and o.shop_id=oi.shop_id
    where v_area='products' and oi.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
      and (p_context->>'productId' is null or oi.product_id::text=p_context->>'productId')
      and (p_context->>'categoryId' is null or exists (
        select 1 from public.products prod where prod.shop_id=oi.shop_id
        and prod.id=oi.product_id and prod.category_id::text=p_context->>'categoryId'))
    union all
    select m.id::text,m.shop_id,m.created_at,'inventory-movement',
      coalesce(i.name,m.movement_type),
      case when m.unit_cost_minor is not null then
        round(case when v_area='profit'
          then m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000
          else -m.quantity_delta_micros::numeric*m.unit_cost_minor/1000000 end)
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
      and (p_context->>'supplierId' is null or po.supplier_id::text=p_context->>'supplierId')
      and (p_context->>'status' is null or po.status=p_context->>'status')
    union all
    select o.id::text,o.shop_id,o.created_at,'customer-order',
      coalesce(o.customer_name_snapshot,'Customer order'),
      o.total_minor::numeric,1::bigint,o.source,false
    from public.orders o where v_area='customers' and o.shop_id=any(p_shop_ids)
      and o.customer_contact_id is not null
      and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
    union all
    select o.id::text,o.shop_id,o.created_at,'delivery-order',
      coalesce(o.delivery_zone_label_snapshot,'Delivery'),
      o.final_delivery_fee_minor::numeric,1::bigint,o.source,false
    from public.orders o where v_area='delivery' and o.shop_id=any(p_shop_ids)
      and o.order_type_behavior_snapshot='DELIVERY'
      and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
    union all
    select o.id::text,o.shop_id,o.created_at,'tax-service',
      'Tax and service charge',
      (o.tax_minor+o.service_charge_minor)::numeric,1::bigint,o.source,false
    from public.orders o where v_area='tax' and o.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
    union all
    select ar.id::text,ar.shop_id,ar.created_at,'return',
      concat('Merchandise return: ',ar.reason_label_snapshot),
      null::numeric,1::bigint,o.source,false
    from public.admin_order_returns ar
    join public.orders o on o.id=ar.order_id and o.shop_id=ar.shop_id
    where v_area='refunds' and ar.business_id=v_business_id
      and ar.shop_id=any(p_shop_ids) and ar.state='POSTED'
      and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
    union all
    select l.id::text,l.shop_id,l.created_at,'loyalty-event',
      concat('Loyalty: ',l.event_type),
      l.monetary_value_minor::numeric,l.points_delta::bigint,
      o.source,false
    from public.loyalty_ledger l
    left join public.orders o on o.id=l.order_id and o.shop_id=l.shop_id
    where v_area='loyalty' and l.business_id=v_business_id
      and l.shop_id=any(p_shop_ids)
      and (p_source is null or o.source=p_source)
      and (p_context='{}'::jsonb or private.plan7_report_order_context_v1(o.shop_id,o.id,p_context))
    union all
    select u.id::text,u.shop_id,u.created_at,'promotion-use',
      concat('Promotion usage: ',u.event_type),
      null::numeric,u.usage_delta::bigint,o.source,false
    from public.promotion_usage_ledger u
    left join public.orders o on o.id=u.order_id and o.shop_id=u.shop_id
    where v_area='promotions' and u.business_id=v_business_id
      and u.shop_id=any(p_shop_ids)
      and (p_context->>'promotionId' is null or u.promotion_id::text=p_context->>'promotionId')
      and (p_source is null or o.source=p_source)
      and (p_context='{}'::jsonb or private.plan7_report_order_context_v1(o.shop_id,o.id,p_context))
    union all
    select cs.id::text,cc.shop_id,cs.assigned_at,'customer-segment',
      concat('Segment: ',cs.segment_key),
      null::numeric,1::bigint,null::text,false
    from public.customer_segments cs
    join lateral (
      select c.shop_id,c.id from public.customer_contacts c
      where c.canonical_customer_id=cs.canonical_customer_id
        and c.shop_id=any(p_shop_ids)
      order by c.shop_id limit 1
    ) cc on true
    where v_area='segments' and cs.business_id=v_business_id
      and (p_context->>'customerId' is null or cc.id::text=p_context->>'customerId')
      and p_source is null
    union all
    select ae.id::text,ae.shop_id,ae.occurred_at,'attendance-event',
      concat('Attendance: ',coalesce(w.display_name,'Worker'),' / ',ae.event_type),
      null::numeric,1::bigint,null::text,false
    from public.attendance_events ae
    left join public.workers w on w.id=ae.worker_id and w.shop_id=ae.shop_id
    where v_area in ('staff','attendance') and ae.business_id=v_business_id
      and ae.shop_id=any(p_shop_ids) and p_source is null
      and (p_context->>'workerId' is null or ae.worker_id::text=p_context->>'workerId')
      and (p_context->>'employeeId' is null or ae.employee_id::text=p_context->>'employeeId')
      and (p_context->>'status' is null or ae.event_type=p_context->>'status')
    union all
    select fm.id::text,fm.shop_id,fm.created_at,'bank-fee',
      'Bank/settlement provider fee',fm.amount_minor::numeric,
      1::bigint,null::text,false
    from public.finance_movements fm
    where v_area in ('expenses','profit') and fm.business_id=v_business_id
      and fm.shop_id=any(p_shop_ids) and fm.movement_type='BANK_FEE'
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
      and (p_context->>'employeeId' is null or sp.employee_id::text=p_context->>'employeeId')
      and p_context->>'workerId' is null and p_context->>'status' is null
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
      'eventCount',a.event_count,
      'orderCount',(
        select count(*) from public.orders o
        where o.shop_id=any(p_shop_ids)
          and (o.created_at at time zone 'Africa/Cairo')::date
            between p_start_date and p_end_date
          and (p_source is null or o.source=p_source)
      and private.plan7_report_order_context_v1(o.shop_id,o.id,p_context)
      ),
      'totalAmountMinor',
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
        when v_area='refunds' then
          'Posted returns are shown as events, not additional cash refunds'
        when v_area='promotions' then
          'Usage events are counted without inventing discount valuation'
        when v_area='segments' then
          'Only canonical customers with a contact in an authorized shop are included'
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
revoke all on function public.admin_finance_report_query_v2(uuid,uuid[],text,date,date,integer,integer,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.admin_finance_report_query_v2(uuid,uuid[],text,date,date,integer,integer,text,jsonb)
  to service_role;

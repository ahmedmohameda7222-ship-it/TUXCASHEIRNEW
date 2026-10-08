-- Plan 7 P0 report permissions + P1 paid-product truth. Forward-only after applied 20261008138000.
-- Report domain authorization is enforced in trusted SQL in addition to the BFF;
-- existing historic migrations are left untouched.
-- Shared deny-by-default Plan 7 SQL guard mirrors apps/admin/server/reports/reportAuthorization.ts.
create or replace function private.plan7_report_required_permission_v1(p_area text)
returns text language sql immutable set search_path=pg_catalog,public,private
as $$
  select case p_area
    when 'profit' then 'finance.view'
    when 'payments' then 'finance.view'
    when 'expenses' then 'finance.view'
    when 'bank-cash' then 'finance.view'
    when 'end-day' then 'finance.view'
    when 'tax' then 'finance.view'
    when 'refunds' then 'finance.view'
    when 'margin-variance' then 'finance.view'
    when 'inventory-consumption' then 'inventory.view'
    when 'waste' then 'inventory.view'
    when 'theoretical-variance' then 'inventory.view'
    when 'purchasing' then 'purchasing.view'
    when 'delivery' then 'delivery.view'
    when 'staff' then 'staff.view'
    when 'attendance' then 'staff.view'
    when 'customers' then 'customers.view'
    when 'segments' then 'customers.view'
    when 'loyalty' then 'loyalty.manage'
    when 'promotions' then 'promotions.manage'
    when 'products' then 'catalog.view'
    when 'sales' then 'reports.view'
    when 'shop-comparison' then 'reports.view'
    else null
  end;
$$;
revoke all on function private.plan7_report_required_permission_v1(text)
  from public,anon,authenticated;

create or replace function private.plan7_report_context_allowed_v1(
  p_actor_employee_id uuid,p_shop_id uuid,p_context jsonb
) returns boolean language sql stable security definer
set search_path=pg_catalog,public,private as $$
select coalesce((
  select bool_and(exists(
    select 1 from public.resolve_admin_authorization_v1(
      p_actor_employee_id,p_shop_id,
      case k
        when 'paymentMethodId' then 'finance.view'
        when 'workerId' then 'staff.view'
        when 'employeeId' then 'staff.view'
        when 'customerId' then 'customers.view'
        when 'productId' then 'catalog.view'
        when 'categoryId' then 'catalog.view'
        when 'promotionId' then 'promotions.manage'
        when 'supplierId' then 'purchasing.view'
        when 'deliveryZoneId' then 'delivery.view'
        else 'reports.view'
      end
    ) a where a.authorized
  ))
  from jsonb_each_text(p_context) ctx(k,v)
  where k in ('paymentMethodId','workerId','employeeId','customerId',
    'productId','categoryId','promotionId','supplierId','deliveryZoneId')
    and v is not null and v<>''
),true);
$$;
revoke all on function private.plan7_report_context_allowed_v1(uuid,uuid,jsonb)
  from public,anon,authenticated;


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
    if not exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop_id,
        private.plan7_report_required_permission_v1(v_area)) a where a.authorized
    ) then
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
    if not exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop_id,
        private.plan7_report_required_permission_v1(v_area)) a where a.authorized
    ) then
      return jsonb_build_object('ok',false,'code','permission_forbidden');
    end if;
    if not private.plan7_report_context_allowed_v1(
      p_actor_employee_id,v_shop_id,p_context) then
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

create or replace function public.admin_plan7_dashboard_metrics_v1(
  p_actor_employee_id uuid,p_shop_ids uuid[],p_start_date date,p_end_date date
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_shop uuid; v_business_id uuid; v_authorized boolean; v_role text;
  v_can_approve boolean:=true; v_profit jsonb;
  v_can_finance boolean:=true; v_can_inventory boolean:=true;
  v_can_staff boolean:=true; v_can_delivery boolean:=true;
  v_can_catalog boolean:=true;
  v_result jsonb;
begin
  if p_shop_ids is null or cardinality(p_shop_ids) not between 1 and 50
     or (select count(distinct id) from unnest(p_shop_ids) id)<>cardinality(p_shop_ids)
     or p_start_date is null or p_end_date is null or p_end_date<p_start_date
     or p_end_date-p_start_date>31 then
    return jsonb_build_object('ok',false,'code','dashboard_scope_invalid');
  end if;
  foreach v_shop in array p_shop_ids loop
    select a.business_id,a.authorized,a.employee_role
    into v_business_id,v_authorized,v_role
    from public.resolve_admin_authorization_v1(
      p_actor_employee_id,v_shop,'reports.view') a;
    if not coalesce(v_authorized,false) or v_business_id is null then
      return jsonb_build_object('ok',false,'code','permission_forbidden');
    end if;
    v_can_approve := v_can_approve and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'approvals.review') a where a.authorized);
    v_can_finance := v_can_finance and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'finance.view') a where a.authorized);
    v_can_inventory := v_can_inventory and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'inventory.view') a where a.authorized);
    v_can_staff := v_can_staff and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'staff.view') a where a.authorized);
    v_can_delivery := v_can_delivery and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'delivery.view') a where a.authorized);
    v_can_catalog := v_can_catalog and exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'catalog.view') a where a.authorized);
  end loop;
  if v_can_finance then
    v_profit:=public.admin_finance_report_query_v2(
      p_actor_employee_id,p_shop_ids,'profit',
      p_start_date,p_end_date,1,0,null::text,'{}'::jsonb);
    if v_profit->>'ok'<>'true' then return v_profit; end if;
  else
    v_profit := '{}'::jsonb;
  end if;

  with scope_orders as (
    select o.id,o.shop_id,o.created_at,o.source,o.status,
      o.order_type_behavior_snapshot from public.orders o
    where o.shop_id=any(p_shop_ids)
      and (o.created_at at time zone 'Africa/Cairo')::date
        between p_start_date and p_end_date
  ),
  cash_events as (
    select o.shop_id,o.source,(o.created_at at time zone 'Africa/Cairo')::date event_date,
      p.allocated_minor::numeric amount_minor
    from public.payments p join public.orders o
      on o.id=p.order_id and o.shop_id=p.shop_id
    where o.shop_id=any(p_shop_ids)
      and (o.created_at at time zone 'Africa/Cairo')::date
        between p_start_date and p_end_date
    union all
    select r.shop_id,o.source,(r.created_at at time zone 'Africa/Cairo')::date,
      -r.amount_minor::numeric
    from public.admin_order_refunds r join public.orders o
      on o.id=r.order_id and o.shop_id=r.shop_id
    where r.business_id=v_business_id and r.shop_id=any(p_shop_ids)
      and r.state='POSTED'
      and (r.created_at at time zone 'Africa/Cairo')::date
        between p_start_date and p_end_date
  ),
  tracked_inventory as (
    select i.id,i.shop_id,i.low_stock_threshold_micros,
      coalesce(sum(m.quantity_delta_micros),0)::numeric balance
    from public.inventory_items i
    left join public.inventory_movements m on m.inventory_item_id=i.id and m.shop_id=i.shop_id
    where i.shop_id=any(p_shop_ids) and i.active
      and i.tracking_mode='RECIPE_TRACKED'
    group by i.id,i.shop_id,i.low_stock_threshold_micros
  ),
  product_rank as (
    select oi.product_id,oi.product_name_snapshot label,
      coalesce(sum(oi.quantity),0)::bigint quantity,
      coalesce(sum(oi.quantity*oi.unit_price_minor),0)::bigint sales_minor
    from public.order_items oi join scope_orders o
      on o.id=oi.order_id and o.shop_id=oi.shop_id
    where o.status in ('DONE','ACTIVE')
      and exists (select 1 from public.payments p
        where p.shop_id=o.shop_id and p.order_id=o.id
          and p.allocated_minor>0)
      -- A partially paid order counts its item quantity once, never per payment.
    group by oi.product_id,oi.product_name_snapshot
    order by quantity desc,sales_minor desc,oi.product_id
    limit 5
  ),
  shop_totals as (
    select s.id,s.name,
      (select count(*) from scope_orders o where o.shop_id=s.id) order_count,
      (select coalesce(sum(e.amount_minor),0)::bigint
       from cash_events e where e.shop_id=s.id) net_sales_minor
    from public.shops s where s.id=any(p_shop_ids)
  )
  select jsonb_build_object(
    'ok',true,
    'periodStart',p_start_date,'periodEnd',p_end_date,
    'orderCount',(select count(*) from scope_orders),
    'netSalesMinor',(select coalesce(sum(e.amount_minor),0)::bigint from cash_events e),
    'averageOrderMinor',(select case when count(*)=0 then null else
      round((select coalesce(sum(e.amount_minor),0) from cash_events e)/count(*))::bigint end
      from (select distinct p.order_id
        from public.payments p
        join scope_orders paid on paid.id=p.order_id and paid.shop_id=p.shop_id
      ) paid_orders),
    'estimatedOperatingProfitMinor',case when v_can_finance
      then v_profit->'summary'->'totalAmountMinor' else null end,
    'lowStockCount',case when not v_can_inventory
      or (select count(*) from tracked_inventory)=0 then null
      else (select count(*) from tracked_inventory t
        where t.balance<=coalesce(t.low_stock_threshold_micros,0) and t.balance>0) end,
    'outOfStockCount',case when not v_can_inventory
      or (select count(*) from tracked_inventory)=0 then null
      else (select count(*) from tracked_inventory t where t.balance<=0) end,
    'failedOnlineOrderCount',(select count(*) from public.online_order_requests r
      where r.shop_id=any(p_shop_ids) and r.status='REJECTED'
      and (r.created_at at time zone 'Africa/Cairo')::date
        between p_start_date and p_end_date),
    'pendingApprovalCount',case when v_can_approve then
      (select count(*) from public.admin_approval_requests ar
       where ar.business_id=v_business_id and ar.status='PENDING'
       and (ar.shop_id=any(p_shop_ids) or
         (ar.shop_id is null and v_role in ('OWNER','ADMIN')))
       and (ar.expires_at is null or ar.expires_at>now()))
      else null end,
    'deliveryOpenCount',case when v_can_delivery then (select count(*) from scope_orders o
      where o.order_type_behavior_snapshot='DELIVERY' and o.status='ACTIVE') else null end,
    'staffOnShiftCount',case when v_can_staff then (select count(distinct a.employee_id)
      from public.attendance_events a
      where a.business_id=v_business_id and a.shop_id=any(p_shop_ids)
        and a.event_type='SESSION_START'
        and not exists(select 1 from public.attendance_events ended
          where ended.business_id=a.business_id and ended.shop_id=a.shop_id
            and ended.worker_session_id=a.worker_session_id
            and ended.event_type='SESSION_END'
            and ended.occurred_at>=a.occurred_at)) else null end,
    'salesTrend',(select coalesce(jsonb_agg(jsonb_build_object(
        'date',d.day::date,'netSalesMinor',coalesce(t.net_minor,0))
        order by d.day),'[]'::jsonb)
      from generate_series(p_start_date,p_end_date,interval '1 day') d(day)
      left join (select event_date,sum(amount_minor)::bigint net_minor
        from cash_events group by event_date) t on t.event_date=d.day::date),
    'topProducts',case when v_can_catalog then (select coalesce(jsonb_agg(jsonb_build_object(
        'name',p.label,'quantity',p.quantity,'recordedSalesMinor',p.sales_minor)
        order by p.quantity desc,p.sales_minor desc),'[]'::jsonb) from product_rank p)
      else '[]'::jsonb end,
    'sourceMix',(select coalesce(jsonb_agg(jsonb_build_object(
        'source',a.source,'orderCount',a.orders)
        order by a.source),'[]'::jsonb) from (
        select o.source,count(*) orders from scope_orders o group by o.source) a),
    'shopComparison',(select coalesce(jsonb_agg(jsonb_build_object(
        'shopName',s.name,'orderCount',s.order_count,
        'netSalesMinor',s.net_sales_minor)
        order by s.name),'[]'::jsonb) from shop_totals s)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_plan7_dashboard_metrics_v1(uuid,uuid[],date,date)
  from public,anon,authenticated;
grant execute on function public.admin_plan7_dashboard_metrics_v1(uuid,uuid[],date,date)
  to service_role;

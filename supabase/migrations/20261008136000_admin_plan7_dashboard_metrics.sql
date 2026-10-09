-- Plan 7: role-scoped Home dashboard KPIs based solely on existing canonical events.
create or replace function public.admin_plan7_dashboard_metrics_v1(
  p_actor_employee_id uuid,p_shop_ids uuid[],p_start_date date,p_end_date date
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare
  v_shop uuid; v_business_id uuid; v_authorized boolean; v_role text;
  v_can_approve boolean:=false; v_profit jsonb;
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
    if exists (
      select 1 from public.resolve_admin_authorization_v1(
        p_actor_employee_id,v_shop,'approvals.review') a where a.authorized
    ) then v_can_approve:=true; end if;
  end loop;
  v_profit:=public.admin_finance_report_query_v2(
    p_actor_employee_id,p_shop_ids,'profit',
    p_start_date,p_end_date,1,0,null::text,'{}'::jsonb);
  if v_profit->>'ok'<>'true' then return v_profit; end if;

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
      from scope_orders),
    'estimatedOperatingProfitMinor',v_profit->'summary'->'totalAmountMinor',
    'lowStockCount',case when (select count(*) from tracked_inventory)=0 then null
      else (select count(*) from tracked_inventory t
        where t.balance<=coalesce(t.low_stock_threshold_micros,0) and t.balance>0) end,
    'outOfStockCount',case when (select count(*) from tracked_inventory)=0 then null
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
    'deliveryOpenCount',(select count(*) from scope_orders o
      where o.order_type_behavior_snapshot='DELIVERY' and o.status='ACTIVE'),
    'staffOnShiftCount',(select count(distinct a.employee_id)
      from public.attendance_events a
      where a.business_id=v_business_id and a.shop_id=any(p_shop_ids)
        and a.event_type='SESSION_START'
        and not exists(select 1 from public.attendance_events ended
          where ended.business_id=a.business_id and ended.shop_id=a.shop_id
            and ended.worker_session_id=a.worker_session_id
            and ended.event_type='SESSION_END'
            and ended.occurred_at>=a.occurred_at)),
    'salesTrend',(select coalesce(jsonb_agg(jsonb_build_object(
        'date',d.day::date,'netSalesMinor',coalesce(t.net_minor,0))
        order by d.day),'[]'::jsonb)
      from generate_series(p_start_date,p_end_date,interval '1 day') d(day)
      left join (select event_date,sum(amount_minor)::bigint net_minor
        from cash_events group by event_date) t on t.event_date=d.day::date),
    'topProducts',(select coalesce(jsonb_agg(jsonb_build_object(
        'name',p.label,'quantity',p.quantity,'recordedSalesMinor',p.sales_minor)
        order by p.quantity desc,p.sales_minor desc),'[]'::jsonb) from product_rank p),
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

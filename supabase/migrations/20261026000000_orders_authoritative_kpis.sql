-- Orders O2 / REVIEWED V2: authoritative complete-shop order KPIs.
-- DEV project only until the mandatory migration and production gates are approved.
-- Financial recognition matches existing plan7 reporting:
--   payment allocated_minor recognized by the original order placement timestamp,
--   POSTED refunds deducted by posted refund event timestamp.
-- This deliberately excludes unposted/pending refunds and never uses order.total_minor.
-- Date filters are UTC instants produced by the Cairo datetime-local UI.
-- All orders (including CANCELLED and RETURNED) count as placed orders.
-- The AOV denominator counts distinct paid orders placed in the period, not payments.
-- Positive and negative finance facts can cross calendar periods, like canonical Reports.
create or replace function public.admin_orders_kpis_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_business_id uuid;
  v_authorized boolean := false;
  v_can_finance boolean := false;
  v_orders bigint := 0;
  v_active bigint := 0;
  v_paid_orders bigint := 0;
  v_net numeric := 0;
  v_average numeric;
begin
  if p_actor_employee_id is null or p_shop_id is null
    or (p_from is not null and p_to is not null
      and (p_to < p_from or p_to - p_from > interval '366 days')) then
    return jsonb_build_object('ok', false, 'code', 'orders_kpi_range_invalid');
  end if;

  select a.business_id, a.authorized into v_business_id, v_authorized
  from public.resolve_admin_authorization_v1(
    p_actor_employee_id, p_shop_id, 'orders.view'
  ) a;

  if not coalesce(v_authorized, false) or v_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'permission_forbidden');
  end if;

  select exists(
    select 1 from public.resolve_admin_authorization_v1(
      p_actor_employee_id, p_shop_id, 'finance.view'
    ) a
    where a.authorized and a.business_id = v_business_id
  ) into v_can_finance;

  select count(*), count(*) filter (where o.status = 'ACTIVE')
  into v_orders, v_active
  from public.orders o
  where o.shop_id = p_shop_id
    and (p_from is null or o.created_at >= p_from)
    and (p_to is null or o.created_at <= p_to);

  if v_can_finance then
    select count(distinct p.order_id) into v_paid_orders
    from public.payments p
    join public.orders o on o.id = p.order_id and o.shop_id = p.shop_id
    where o.shop_id = p_shop_id and p.allocated_minor > 0
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at <= p_to);

    select coalesce(sum(ev.amount_minor), 0)::numeric into v_net
    from (
      select p.allocated_minor::numeric amount_minor
      from public.payments p
      join public.orders o on o.id = p.order_id and o.shop_id = p.shop_id
      where o.shop_id = p_shop_id
        and (p_from is null or o.created_at >= p_from)
        and (p_to is null or o.created_at <= p_to)
      union all
      select -r.amount_minor::numeric
      from public.admin_order_refunds r
      join public.orders o on o.id = r.order_id and o.shop_id = r.shop_id
      where r.business_id = v_business_id and r.shop_id = p_shop_id
        and r.state = 'POSTED'
        and (p_from is null or r.created_at >= p_from)
        and (p_to is null or r.created_at <= p_to)
    ) ev;

    -- Do not round/serialize financial fields outside the JS safe integer range.
    if abs(v_net) > 9007199254740991 then
      return jsonb_build_object('ok',false,'code','orders_kpi_overflow');
    end if;
    v_average := case when v_paid_orders = 0 then null
      else round(v_net / v_paid_orders) end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'shopId', p_shop_id,
    'orderCount', v_orders,
    'activeOrderCount', v_active,
    'netSalesMinor', case when v_can_finance then v_net::bigint else null end,
    'averageOrderMinor', case when v_can_finance then v_average::bigint else null end,
    'denominatorPaidOrderCount', case when v_can_finance then v_paid_orders else null end
  );
end;
$function$;

-- Public schema functions are executable by PUBLIC by default: close that vector.
revoke all on function public.admin_orders_kpis_v1(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_orders_kpis_v1(uuid, uuid, timestamptz, timestamptz)
  to service_role;

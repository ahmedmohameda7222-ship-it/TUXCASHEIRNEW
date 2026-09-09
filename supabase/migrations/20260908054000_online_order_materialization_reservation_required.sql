-- Require every remotely materialized ONLINE order to match the durable processing
-- reservation that authorized its order id. Preserve the request -> reservation lock
-- order introduced by the retired-origin transfer fence so materialization and
-- controlled ownership transfer remain serialized.

create or replace function private.assert_tux_online_order_materialization_origin(
  p_device_id uuid,
  p_shop_id uuid,
  p_mutation jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row jsonb := p_mutation -> 'row';
  v_order_id uuid;
  v_request_id uuid;
  v_locked_request_id uuid;
  v_origin_device_id uuid;
begin
  if p_mutation ->> 'table' is distinct from 'orders'
     or v_row ->> 'source' is distinct from 'ONLINE' then
    return;
  end if;

  v_order_id := nullif(v_row ->> 'id', '')::uuid;
  if v_order_id is null then
    return;
  end if;

  select reservation.request_id
    into v_request_id
  from private.online_order_processing_reservations reservation
  where reservation.shop_id = p_shop_id
    and reservation.processing_order_id = v_order_id;

  if not found then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;

  -- Claiming locks the request before touching its reservation. Match that order here
  -- so transfer and materialization cannot pass each other in flight.
  select request.id
    into v_locked_request_id
  from public.online_order_requests request
  where request.id = v_request_id
    and request.shop_id = p_shop_id
  for update;

  if v_locked_request_id is null then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;

  select reservation.origin_device_id
    into v_origin_device_id
  from private.online_order_processing_reservations reservation
  where reservation.request_id = v_request_id
    and reservation.shop_id = p_shop_id
    and reservation.processing_order_id = v_order_id
  for update;

  if v_origin_device_id is null then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;
  if v_origin_device_id is distinct from p_device_id then
    raise exception 'TUX_ONLINE_ORDER_RESERVATION_DEVICE_MISMATCH';
  end if;
end;
$$;

revoke all on function private.assert_tux_online_order_materialization_origin(uuid, uuid, jsonb)
  from public, anon, authenticated;

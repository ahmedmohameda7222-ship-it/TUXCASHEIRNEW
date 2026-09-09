-- Explicit Release relinquishes both the PROCESSING lease and its durable reservation.
-- Lock order intentionally matches claim/materialization: request row first, reservation row second.
-- This fences delayed materialization from the released device and lets the next claimant create
-- a fresh reservation/order identity even while the releasing device remains authorized.

create or replace function public.release_tux_online_order_request_claim_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_request_id uuid,
  p_processing_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shop_id uuid;
  v_request public.online_order_requests%rowtype;
  v_origin_device_id uuid;
begin
  v_shop_id := private.tux_operations_device_shop_v1(p_auth_user_id, p_device_id);
  if v_shop_id is null then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;

  select * into v_request
  from public.online_order_requests request
  where request.id = p_request_id
    and request.shop_id = v_shop_id
  for update;

  if not found then
    raise exception 'TUX_ONLINE_ORDER_NOT_FOUND';
  end if;

  if v_request.status = 'PENDING' then
    v_origin_device_id := null;

    select reservation.origin_device_id
      into v_origin_device_id
    from private.online_order_processing_reservations reservation
    where reservation.request_id = v_request.id
      and reservation.shop_id = v_shop_id
      and reservation.processing_order_id = p_processing_order_id
    for update;

    if found then
      if v_origin_device_id is distinct from p_device_id then
        raise exception 'TUX_ONLINE_ORDER_CLAIM_MISMATCH';
      end if;

      delete from private.online_order_processing_reservations reservation
      where reservation.request_id = v_request.id
        and reservation.shop_id = v_shop_id
        and reservation.processing_order_id = p_processing_order_id
        and reservation.origin_device_id = p_device_id;

      if not found then
        raise exception 'TUX_ONLINE_ORDER_RESERVATION_RELEASE_CONFLICT';
      end if;
    end if;

    return jsonb_build_object('requestId', v_request.id, 'status', 'PENDING');
  end if;

  if v_request.status <> 'PROCESSING' then
    raise exception 'TUX_ONLINE_ORDER_ALREADY_RESOLVED';
  end if;
  if v_request.processing_device_id is distinct from p_device_id
     or v_request.processing_order_id is distinct from p_processing_order_id then
    raise exception 'TUX_ONLINE_ORDER_CLAIM_MISMATCH';
  end if;

  select reservation.origin_device_id
    into v_origin_device_id
  from private.online_order_processing_reservations reservation
  where reservation.request_id = v_request.id
    and reservation.shop_id = v_shop_id
    and reservation.processing_order_id = p_processing_order_id
  for update;

  if v_origin_device_id is null
     or v_origin_device_id is distinct from p_device_id then
    raise exception 'TUX_ONLINE_ORDER_CLAIM_MISMATCH';
  end if;

  delete from private.online_order_processing_reservations reservation
  where reservation.request_id = v_request.id
    and reservation.shop_id = v_shop_id
    and reservation.processing_order_id = p_processing_order_id
    and reservation.origin_device_id = p_device_id;

  if not found then
    raise exception 'TUX_ONLINE_ORDER_RESERVATION_RELEASE_CONFLICT';
  end if;

  update public.online_order_requests request
  set status = 'PENDING',
      processing_device_id = null,
      processing_order_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      updated_at = now()
  where request.id = v_request.id;

  return jsonb_build_object('requestId', v_request.id, 'status', 'PENDING');
end;
$$;

revoke all on function public.release_tux_online_order_request_claim_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_tux_online_order_request_claim_v1(uuid, uuid, uuid, uuid)
  to service_role;
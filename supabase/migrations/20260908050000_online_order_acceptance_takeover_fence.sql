-- Expose durable reservation ownership with each Operations online-order claim.
-- This lets the local-first acceptance path distinguish the original reserving
-- device from a later claimant that reclaimed the same durable order identity.

create or replace function public.list_tux_online_order_requests_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shop_id uuid;
  v_result jsonb;
begin
  v_shop_id := private.tux_operations_device_shop_v1(p_auth_user_id, p_device_id);
  if v_shop_id is null then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'TUX_ONLINE_ORDER_LIMIT_INVALID';
  end if;

  update public.online_order_requests request
  set status = 'PENDING',
      processing_device_id = null,
      processing_order_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      updated_at = now()
  where request.shop_id = v_shop_id
    and request.status = 'PROCESSING'
    and request.processing_expires_at <= now();

  select coalesce(jsonb_agg(row_payload order by created_at, request_id), '[]'::jsonb)
  into v_result
  from (
    select
      request.id as request_id,
      request.created_at,
      jsonb_build_object(
        'requestId', request.id,
        'shopId', request.shop_id,
        'status', request.status,
        'catalogRevision', request.catalog_revision,
        'fulfillmentPreference', request.fulfillment_preference,
        'paymentPreference', request.payment_preference,
        'customerName', request.customer_name,
        'normalizedPhone', request.normalized_phone,
        'deliveryAddress', request.delivery_address,
        'trustedItems', request.trusted_items,
        'itemsSubtotalMinor', request.items_subtotal_minor,
        'orderNote', request.order_note,
        'createdAt', request.created_at,
        'processingOrderId', request.processing_order_id,
        'processingStartedAt', request.processing_started_at,
        'processingExpiresAt', request.processing_expires_at,
        'processingDeviceId', request.processing_device_id,
        'reservationOriginDeviceId', reservation.origin_device_id
      ) as row_payload
    from public.online_order_requests request
    left join private.online_order_processing_reservations reservation
      on reservation.request_id = request.id
     and reservation.shop_id = request.shop_id
    where request.shop_id = v_shop_id
      and (
        request.status = 'PENDING' or
        (request.status = 'PROCESSING' and request.processing_device_id = p_device_id)
      )
    order by request.created_at, request.id
    limit p_limit
  ) visible_requests;

  return v_result;
end;
$$;

revoke all on function public.list_tux_online_order_requests_v1(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_tux_online_order_requests_v1(uuid, uuid, integer)
  to service_role;

create or replace function public.claim_tux_online_order_request_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_shop_id uuid;
  v_request public.online_order_requests%rowtype;
  v_processing_order_id uuid;
  v_reservation_origin_device_id uuid;
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

  if v_request.status = 'PROCESSING'
     and v_request.processing_expires_at <= now() then
    update public.online_order_requests request
    set status = 'PENDING',
        processing_device_id = null,
        processing_order_id = null,
        processing_started_at = null,
        processing_expires_at = null,
        updated_at = now()
    where request.id = v_request.id
    returning * into v_request;
  end if;

  if v_request.status = 'PENDING' then
    select reservation.processing_order_id, reservation.origin_device_id
      into v_processing_order_id, v_reservation_origin_device_id
    from private.online_order_processing_reservations reservation
    where reservation.request_id = v_request.id
      and reservation.shop_id = v_shop_id;

    if v_processing_order_id is null then
      v_processing_order_id := extensions.gen_random_uuid();
      v_reservation_origin_device_id := p_device_id;
      insert into private.online_order_processing_reservations(
        request_id,
        processing_order_id,
        shop_id,
        origin_device_id,
        reserved_at
      ) values (
        v_request.id,
        v_processing_order_id,
        v_shop_id,
        p_device_id,
        now()
      );
    end if;

    update public.online_order_requests request
    set status = 'PROCESSING',
        processing_device_id = p_device_id,
        processing_order_id = v_processing_order_id,
        processing_started_at = now(),
        processing_expires_at = now() + interval '12 hours',
        updated_at = now()
    where request.id = v_request.id
    returning * into v_request;
  elsif v_request.status = 'PROCESSING' then
    if v_request.processing_device_id is distinct from p_device_id then
      raise exception 'TUX_ONLINE_ORDER_ALREADY_PROCESSING';
    end if;

    insert into private.online_order_processing_reservations(
      request_id,
      processing_order_id,
      shop_id,
      origin_device_id,
      reserved_at
    ) values (
      v_request.id,
      v_request.processing_order_id,
      v_shop_id,
      p_device_id,
      coalesce(v_request.processing_started_at, now())
    ) on conflict (request_id) do nothing;

    select reservation.origin_device_id
      into v_reservation_origin_device_id
    from private.online_order_processing_reservations reservation
    where reservation.request_id = v_request.id
      and reservation.shop_id = v_shop_id
      and reservation.processing_order_id = v_request.processing_order_id;
  else
    raise exception 'TUX_ONLINE_ORDER_ALREADY_RESOLVED';
  end if;

  if v_reservation_origin_device_id is null then
    raise exception 'TUX_ONLINE_ORDER_RESERVATION_MISSING';
  end if;

  return jsonb_build_object(
    'requestId', v_request.id,
    'shopId', v_request.shop_id,
    'status', v_request.status,
    'catalogRevision', v_request.catalog_revision,
    'fulfillmentPreference', v_request.fulfillment_preference,
    'paymentPreference', v_request.payment_preference,
    'customerName', v_request.customer_name,
    'normalizedPhone', v_request.normalized_phone,
    'deliveryAddress', v_request.delivery_address,
    'trustedItems', v_request.trusted_items,
    'itemsSubtotalMinor', v_request.items_subtotal_minor,
    'orderNote', v_request.order_note,
    'createdAt', v_request.created_at,
    'processingOrderId', v_request.processing_order_id,
    'processingStartedAt', v_request.processing_started_at,
    'processingExpiresAt', v_request.processing_expires_at,
    'processingDeviceId', v_request.processing_device_id,
    'reservationOriginDeviceId', v_reservation_origin_device_id
  );
end;
$$;

revoke all on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  to service_role;

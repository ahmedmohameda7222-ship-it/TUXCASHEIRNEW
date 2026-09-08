-- Durable ONLINE-order conversion identity.
-- A PROCESSING lease may expire before a locally committed Operations order reaches
-- the remote materializer. Keep the reserved order identity independently of the
-- ephemeral lease so delayed/retried materialization still resolves exactly one request.

create table private.online_order_processing_reservations (
  request_id uuid primary key references public.online_order_requests(id) on delete cascade,
  processing_order_id uuid not null unique,
  shop_id uuid not null references public.shops(id) on delete cascade,
  reserved_at timestamptz not null default now()
);

create index online_order_processing_reservations_shop_idx
  on private.online_order_processing_reservations(shop_id, reserved_at);

revoke all on table private.online_order_processing_reservations
  from public, anon, authenticated;

-- Preserve any live reservations if this migration is applied after devices have
-- already claimed requests under the previous protocol.
insert into private.online_order_processing_reservations(
  request_id,
  processing_order_id,
  shop_id,
  reserved_at
)
select
  request.id,
  request.processing_order_id,
  request.shop_id,
  coalesce(request.processing_started_at, now())
from public.online_order_requests request
where request.processing_order_id is not null
on conflict (request_id) do nothing;

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
    select reservation.processing_order_id
      into v_processing_order_id
    from private.online_order_processing_reservations reservation
    where reservation.request_id = v_request.id
      and reservation.shop_id = v_shop_id;

    if v_processing_order_id is null then
      v_processing_order_id := extensions.gen_random_uuid();
      insert into private.online_order_processing_reservations(
        request_id,
        processing_order_id,
        shop_id,
        reserved_at
      ) values (
        v_request.id,
        v_processing_order_id,
        v_shop_id,
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
      reserved_at
    ) values (
      v_request.id,
      v_request.processing_order_id,
      v_shop_id,
      coalesce(v_request.processing_started_at, now())
    ) on conflict (request_id) do nothing;
  else
    raise exception 'TUX_ONLINE_ORDER_ALREADY_RESOLVED';
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
    'processingExpiresAt', v_request.processing_expires_at
  );
end;
$$;

revoke all on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  to service_role;

create or replace function private.resolve_tux_online_order_request_from_order_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request_id uuid;
  v_updated integer;
begin
  if new.source <> 'ONLINE' then
    return new;
  end if;

  select reservation.request_id
    into v_request_id
  from private.online_order_processing_reservations reservation
  where reservation.shop_id = new.shop_id
    and reservation.processing_order_id = new.id;

  if v_request_id is null then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;

  update public.online_order_requests request
  set status = 'ACCEPTED',
      accepted_order_id = new.id,
      resolved_at = now(),
      processing_device_id = null,
      processing_order_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      updated_at = now()
  where request.id = v_request_id
    and request.shop_id = new.shop_id
    and request.accepted_order_id is null
    and request.status in ('PENDING', 'PROCESSING');

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.resolve_tux_online_order_request_from_order_v1()
  from public, anon, authenticated;

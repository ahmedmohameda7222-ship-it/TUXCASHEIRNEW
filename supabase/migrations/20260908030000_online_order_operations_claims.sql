-- TUX Operations authenticated review/claim lifecycle for public online-order requests.
-- Repository migration only. Operations devices never read or mutate the request table directly;
-- authenticated Edge code calls the service-role-only RPCs below.

alter table public.online_order_requests
  add column processing_device_id uuid references public.devices(id) on delete restrict,
  add column processing_order_id uuid,
  add column processing_started_at timestamptz,
  add column processing_expires_at timestamptz;

alter table public.online_order_requests
  drop constraint online_order_requests_status_check,
  drop constraint online_order_requests_lifecycle_chk;

alter table public.online_order_requests
  add constraint online_order_requests_status_check
    check (status in ('PENDING', 'PROCESSING', 'ACCEPTED', 'REJECTED')),
  add constraint online_order_requests_lifecycle_chk
    check (
      (status = 'PENDING' and
        accepted_order_id is null and
        rejection_reason is null and
        resolved_at is null and
        processing_device_id is null and
        processing_order_id is null and
        processing_started_at is null and
        processing_expires_at is null) or
      (status = 'PROCESSING' and
        accepted_order_id is null and
        rejection_reason is null and
        resolved_at is null and
        processing_device_id is not null and
        processing_order_id is not null and
        processing_started_at is not null and
        processing_expires_at is not null and
        processing_expires_at > processing_started_at) or
      (status = 'ACCEPTED' and
        accepted_order_id is not null and
        rejection_reason is null and
        resolved_at is not null and
        processing_device_id is null and
        processing_order_id is null and
        processing_started_at is null and
        processing_expires_at is null) or
      (status = 'REJECTED' and
        accepted_order_id is null and
        btrim(coalesce(rejection_reason, '')) <> '' and
        resolved_at is not null and
        processing_device_id is null and
        processing_order_id is null and
        processing_started_at is null and
        processing_expires_at is null)
    );

create unique index online_order_requests_processing_order_uidx
  on public.online_order_requests(processing_order_id)
  where processing_order_id is not null;

create index online_order_requests_processing_device_idx
  on public.online_order_requests(processing_device_id, processing_started_at)
  where status = 'PROCESSING';

create or replace function private.tux_operations_device_shop_v1(
  p_auth_user_id uuid,
  p_device_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select device.shop_id
  from public.devices device
  join public.shop_memberships membership
    on membership.shop_id = device.shop_id
   and membership.auth_user_id = device.auth_user_id
  where device.id = p_device_id
    and device.auth_user_id = p_auth_user_id
    and device.active
    and membership.auth_user_id = p_auth_user_id
    and membership.role = 'OPERATIONS_DEVICE'
    and membership.active
  limit 1;
$$;

revoke all on function private.tux_operations_device_shop_v1(uuid, uuid)
  from public, anon, authenticated;

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
        'processingExpiresAt', request.processing_expires_at
      ) as row_payload
    from public.online_order_requests request
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
    set status = 'PROCESSING',
        processing_device_id = p_device_id,
        processing_order_id = extensions.gen_random_uuid(),
        processing_started_at = now(),
        processing_expires_at = now() + interval '12 hours',
        updated_at = now()
    where request.id = v_request.id
    returning * into v_request;
  elsif v_request.status = 'PENDING' then
    update public.online_order_requests request
    set status = 'PROCESSING',
        processing_device_id = p_device_id,
        processing_order_id = extensions.gen_random_uuid(),
        processing_started_at = now(),
        processing_expires_at = now() + interval '12 hours',
        updated_at = now()
    where request.id = v_request.id
    returning * into v_request;
  elsif v_request.status = 'PROCESSING' then
    if v_request.processing_device_id is distinct from p_device_id then
      raise exception 'TUX_ONLINE_ORDER_ALREADY_PROCESSING';
    end if;
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
    return jsonb_build_object('requestId', v_request.id, 'status', 'PENDING');
  end if;
  if v_request.status <> 'PROCESSING' then
    raise exception 'TUX_ONLINE_ORDER_ALREADY_RESOLVED';
  end if;
  if v_request.processing_device_id is distinct from p_device_id
     or v_request.processing_order_id is distinct from p_processing_order_id then
    raise exception 'TUX_ONLINE_ORDER_CLAIM_MISMATCH';
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

create or replace function public.reject_tux_online_order_request_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_request_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shop_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_request public.online_order_requests%rowtype;
begin
  v_shop_id := private.tux_operations_device_shop_v1(p_auth_user_id, p_device_id);
  if v_shop_id is null then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;
  if v_reason = '' or length(v_reason) > 500 then
    raise exception 'TUX_ONLINE_ORDER_REJECTION_REASON_INVALID';
  end if;

  select * into v_request
  from public.online_order_requests request
  where request.id = p_request_id
    and request.shop_id = v_shop_id
  for update;

  if not found then
    raise exception 'TUX_ONLINE_ORDER_NOT_FOUND';
  end if;
  if v_request.status = 'REJECTED' then
    if v_request.rejection_reason is distinct from v_reason then
      raise exception 'TUX_ONLINE_ORDER_REJECTION_CONFLICT';
    end if;
    return jsonb_build_object('requestId', v_request.id, 'status', 'REJECTED');
  end if;
  if v_request.status = 'ACCEPTED' then
    raise exception 'TUX_ONLINE_ORDER_ALREADY_RESOLVED';
  end if;
  if v_request.status = 'PROCESSING'
     and v_request.processing_device_id is distinct from p_device_id then
    raise exception 'TUX_ONLINE_ORDER_ALREADY_PROCESSING';
  end if;

  update public.online_order_requests request
  set status = 'REJECTED',
      rejection_reason = v_reason,
      resolved_at = now(),
      processing_device_id = null,
      processing_order_id = null,
      processing_started_at = null,
      processing_expires_at = null,
      updated_at = now()
  where request.id = v_request.id;

  return jsonb_build_object('requestId', v_request.id, 'status', 'REJECTED');
end;
$$;

revoke all on function public.list_tux_online_order_requests_v1(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.release_tux_online_order_request_claim_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reject_tux_online_order_request_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.list_tux_online_order_requests_v1(uuid, uuid, integer)
  to service_role;
grant execute on function public.claim_tux_online_order_request_v1(uuid, uuid, uuid)
  to service_role;
grant execute on function public.release_tux_online_order_request_claim_v1(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.reject_tux_online_order_request_v1(uuid, uuid, uuid, text)
  to service_role;

create or replace function private.resolve_tux_online_order_request_from_order_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_updated integer;
begin
  if new.source <> 'ONLINE' then
    return new;
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
  where request.shop_id = new.shop_id
    and request.status = 'PROCESSING'
    and request.processing_order_id = new.id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'TUX_ONLINE_ORDER_PROCESSING_MATCH_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.resolve_tux_online_order_request_from_order_v1()
  from public, anon, authenticated;

drop trigger if exists orders_resolve_online_request_after_materialization on public.orders;
create trigger orders_resolve_online_request_after_materialization
  after insert on public.orders
  for each row
  when (new.source = 'ONLINE')
  execute function private.resolve_tux_online_order_request_from_order_v1();

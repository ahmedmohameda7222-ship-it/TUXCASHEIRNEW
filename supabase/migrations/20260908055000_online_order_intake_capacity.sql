create or replace function private.enforce_tux_online_order_intake_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_active_count bigint;
  v_recent_count bigint;
begin
  perform pg_advisory_xact_lock(
    hashtext('tux-online-order-intake:' || new.shop_id::text)
  );

  if exists (
    select 1
    from public.online_order_requests
    where shop_id = new.shop_id
      and idempotency_key = new.idempotency_key
  ) then
    return new;
  end if;

  select count(*)
  into v_active_count
  from public.online_order_requests
  where shop_id = new.shop_id
    and status in ('PENDING', 'PROCESSING');

  select count(*)
  into v_recent_count
  from public.online_order_requests
  where shop_id = new.shop_id
    and created_at >= now() - interval '1 minute';

  if v_active_count >= 150 or v_recent_count >= 30 then
    raise exception 'TUX_ONLINE_ORDER_INTAKE_CAPACITY_EXCEEDED';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_tux_online_order_intake_capacity() from public;

drop trigger if exists trg_online_order_intake_capacity on public.online_order_requests;
create trigger trg_online_order_intake_capacity
before insert on public.online_order_requests
for each row
execute function private.enforce_tux_online_order_intake_capacity();

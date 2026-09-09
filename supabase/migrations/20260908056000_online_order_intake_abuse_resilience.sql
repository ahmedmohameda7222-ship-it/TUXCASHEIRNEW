-- Bound anonymous intake abuse without turning the active Operations queue into a permanent
-- shop-wide kill switch. The Edge function writes a one-way fingerprint derived from the
-- gateway-observed client address; raw client addresses are never persisted.

alter table public.online_order_requests
  add column source_fingerprint text
    check (source_fingerprint is null or source_fingerprint ~ '^[0-9a-f]{64}$');

create index online_order_requests_source_recent_idx
  on public.online_order_requests(shop_id, source_fingerprint, created_at desc)
  where source_fingerprint is not null;

create or replace function private.enforce_tux_online_order_intake_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
  v_source_recent_count bigint;
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

  -- Unreviewed anonymous requests cannot consume intake capacity forever. Claimed
  -- PROCESSING requests are intentionally excluded because Operations owns that lifecycle.
  update public.online_order_requests
  set status = 'REJECTED',
      rejection_reason = 'INTAKE_EXPIRED_UNREVIEWED',
      resolved_at = v_now,
      updated_at = v_now
  where shop_id = new.shop_id
    and status = 'PENDING'
    and created_at < v_now - interval '6 hours';

  -- Public intake always supplies a gateway-derived fingerprint. Null remains tolerated
  -- for privileged migration/test/backfill paths that are not reachable by anonymous callers.
  if new.source_fingerprint is not null then
    select count(*)
    into v_source_recent_count
    from public.online_order_requests
    where shop_id = new.shop_id
      and source_fingerprint = new.source_fingerprint
      and created_at >= v_now - interval '5 minutes';

    if v_source_recent_count >= 20 then
      raise exception 'TUX_ONLINE_ORDER_INTAKE_SOURCE_RATE_LIMITED';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_tux_online_order_intake_capacity() from public;

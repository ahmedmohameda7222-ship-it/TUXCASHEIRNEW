-- Serialize worker-session attachment with Business Day transitions, then
-- re-check the canonical session set inside the same transaction that records
-- a BUSINESS_DAY_CLOSED receipt. This closes the prepare-exit/End-Day TOCTOU.
create or replace function private.tux_guard_business_day_dependency_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_shop_id uuid; v_status text;
begin
  if new.business_day_id is null then return new; end if;
  select shop_id, status into v_shop_id, v_status
    from public.business_days where id = new.business_day_id;
  if v_shop_id is null then
    raise exception 'TUX_BUSINESS_DAY_DEPENDENCY_MISSING:%', new.business_day_id;
  end if;
  if tg_table_name = 'worker_sessions' then
    perform pg_advisory_xact_lock(hashtextextended('tux:business_day:' || v_shop_id::text, 0));
    select status into v_status
      from public.business_days where id = new.business_day_id for update;
  end if;
  if v_shop_id <> new.shop_id then
    raise exception 'TUX_BUSINESS_DAY_SHOP_CONFLICT';
  end if;
  if tg_table_name = 'worker_sessions' then
    if new.ended_at is null and v_status = 'CLOSED' then
      raise exception 'TUX_BUSINESS_DAY_ALREADY_CLOSED:%', new.business_day_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.tux_guard_operations_day_close_sessions_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_day_id uuid; v_open_sessions bigint;
begin
  if new.event_type <> 'BUSINESS_DAY_CLOSED' then return new; end if;
  begin
    v_day_id := (new.envelope_json ->> 'businessDayId')::uuid;
  exception when others then
    raise exception 'TUX_SYNC_PROTOCOL_INVALID';
  end;
  perform pg_advisory_xact_lock(hashtextextended(
    'tux:business_day:' || new.shop_id::text, 0
  ));
  select count(*) into v_open_sessions
  from public.worker_sessions ws
  where ws.shop_id = new.shop_id
    and ws.business_day_id = v_day_id
    and ws.ended_at is null;
  if v_open_sessions > 1 then
    raise exception 'TUX_BUSINESS_DAY_OTHER_SESSIONS_ACTIVE:%', v_open_sessions;
  end if;
  return new;
end;
$$;

revoke all on function private.tux_guard_operations_day_close_sessions_v1()
  from public, anon, authenticated;
drop trigger if exists tux_operations_day_close_sessions_guard
  on public.operations_sync_event_receipts;
create trigger tux_operations_day_close_sessions_guard
before insert on public.operations_sync_event_receipts
for each row execute function private.tux_guard_operations_day_close_sessions_v1();

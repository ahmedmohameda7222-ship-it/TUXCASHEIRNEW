-- P0: preserve immutable local Business Day identities while converting generic unique/FK failures
-- into actionable domain conflicts. This is additive and does not rewrite the materialization RPC,
-- its durable receipts, order ownership fences, or the canonical unique and foreign keys.

create or replace function private.tux_guard_business_day_transition_v1()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_open_id uuid;
begin
  -- All OPEN and CLOSE transitions for one shop serialize, including concurrent browsers.
  perform pg_advisory_xact_lock(hashtextextended('tux:business_day:' || new.shop_id::text, 0));
  if tg_op = 'UPDATE' and old.status = 'CLOSED' and new.status = 'OPEN' then
    raise exception 'TUX_BUSINESS_DAY_REOPEN_FORBIDDEN:%', new.id;
  end if;
  if new.status = 'OPEN' then
    select id into v_open_id from public.business_days
      where shop_id = new.shop_id and status = 'OPEN' and id <> new.id
      order by started_at, id limit 1;
    if v_open_id is not null then
      raise exception 'TUX_BUSINESS_DAY_OPEN_CONFLICT:%', v_open_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.tux_guard_business_day_transition_v1() from public, anon, authenticated;
create trigger tux_business_day_transition_guard
before insert or update on public.business_days
for each row execute function private.tux_guard_business_day_transition_v1();

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
  if v_shop_id <> new.shop_id then
    raise exception 'TUX_BUSINESS_DAY_SHOP_CONFLICT';
  end if;
  -- A locally queued End Day emits CLOSED before the final SIGNED_OUT update:
  -- closing an already-existing session remains legal, but a new OPEN worker cannot
  -- join a day the canonical server has already closed.
  if tg_table_name = 'worker_sessions' then
    if new.ended_at is null and v_status = 'CLOSED' then
      raise exception 'TUX_BUSINESS_DAY_ALREADY_CLOSED:%', new.business_day_id;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.tux_guard_business_day_dependency_v1() from public, anon, authenticated;
create trigger tux_worker_session_day_dependency_guard
before insert or update on public.worker_sessions
for each row execute function private.tux_guard_business_day_dependency_v1();
create trigger tux_order_day_dependency_guard
before insert or update on public.orders
for each row execute function private.tux_guard_business_day_dependency_v1();
create trigger tux_reconciliation_day_dependency_guard
before insert or update on public.reconciliations
for each row execute function private.tux_guard_business_day_dependency_v1();
create trigger tux_expense_day_dependency_guard
before insert or update on public.expenses
for each row execute function private.tux_guard_business_day_dependency_v1();
create trigger tux_inventory_movement_day_dependency_guard
before insert or update on public.inventory_movements
for each row execute function private.tux_guard_business_day_dependency_v1();
create trigger tux_order_status_day_dependency_guard
before insert or update on public.order_status_events
for each row execute function private.tux_guard_business_day_dependency_v1();

-- Canonical read is scoped exclusively to the authenticated, active enrolled device.
-- No client-provided shop identity is used to authorize the read.
create or replace function public.read_tux_operations_open_business_day_v1(
  p_auth_user_id uuid,
  p_device_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_shop_id uuid; v_day_id uuid;
begin
  select d.shop_id into v_shop_id from public.devices d
  join public.shop_memberships m on m.shop_id = d.shop_id and m.auth_user_id = d.auth_user_id
  where d.id = p_device_id and d.auth_user_id = p_auth_user_id
    and d.active and m.active and m.role = 'OPERATIONS_DEVICE';
  if v_shop_id is null then raise exception 'TUX_DEVICE_NOT_AUTHORIZED'; end if;
  select bd.id into v_day_id from public.business_days bd
  where bd.shop_id = v_shop_id and bd.status = 'OPEN' limit 1;
  return jsonb_build_object('shopId', v_shop_id, 'openDayId', v_day_id);
end;
$$;
revoke all on function public.read_tux_operations_open_business_day_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.read_tux_operations_open_business_day_v1(uuid,uuid)
  to service_role;

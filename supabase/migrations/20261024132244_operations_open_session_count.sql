-- A worker identity can be signed in from multiple authorized browsers/devices.
-- End-Day routing must therefore count every durable open worker_session row,
-- rather than collapsing concurrent sessions for the same worker identity.
create or replace function public.read_tux_operations_open_business_day_v1(
  p_auth_user_id uuid,
  p_device_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_shop_id uuid; v_day public.business_days%rowtype; v_worker_count bigint := 0;
begin
  select d.shop_id into v_shop_id from public.devices d
  join public.shop_memberships m on m.shop_id = d.shop_id and m.auth_user_id = d.auth_user_id
  where d.id = p_device_id and d.auth_user_id = p_auth_user_id
    and d.active and m.active and m.role = 'OPERATIONS_DEVICE';
  if v_shop_id is null then raise exception 'TUX_DEVICE_NOT_AUTHORIZED'; end if;
  select bd.* into v_day from public.business_days bd
  where bd.shop_id = v_shop_id and bd.status = 'OPEN' limit 1;
  if v_day.id is not null then
    select count(*) into v_worker_count from public.worker_sessions ws
    where ws.business_day_id = v_day.id and ws.shop_id = v_shop_id and ws.ended_at is null;
  end if;
  return jsonb_build_object(
    'shopId', v_shop_id,
    'openDayId', v_day.id,
    'openWorkerCount', v_worker_count,
    'openDay', case when v_day.id is null then null else
      jsonb_build_object(
        'id', v_day.id,
        'shopId', v_day.shop_id,
        'status', 'OPEN',
        'startedAt', v_day.started_at,
        'startedByWorkerId', v_day.started_by_worker_id,
        'endedAt', null,
        'endedByWorkerId', null,
        'lastAllocatedDisplayOrderNo', v_day.last_allocated_display_order_no
      )
    end
  );
end;
$$;
revoke all on function public.read_tux_operations_open_business_day_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.read_tux_operations_open_business_day_v1(uuid,uuid)
  to service_role;

create or replace function public.read_tux_operations_business_day_state_v2(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_local_day_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_shop_id uuid; v_day public.business_days%rowtype;
        v_worker_count bigint := 0; v_local_day_status text;
begin
  select d.shop_id into v_shop_id from public.devices d
  join public.shop_memberships m on m.shop_id = d.shop_id and m.auth_user_id = d.auth_user_id
  where d.id = p_device_id and d.auth_user_id = p_auth_user_id
    and d.active and m.active and m.role = 'OPERATIONS_DEVICE';
  if v_shop_id is null then raise exception 'TUX_DEVICE_NOT_AUTHORIZED'; end if;
  if p_local_day_id is not null then
    select bd.status into v_local_day_status from public.business_days bd
    where bd.id = p_local_day_id and bd.shop_id = v_shop_id;
  end if;
  select bd.* into v_day from public.business_days bd
  where bd.shop_id = v_shop_id and bd.status = 'OPEN' limit 1;
  if v_day.id is not null then
    select count(*) into v_worker_count from public.worker_sessions ws
    where ws.business_day_id = v_day.id and ws.shop_id = v_shop_id and ws.ended_at is null;
  end if;
  return jsonb_build_object(
    'shopId', v_shop_id,
    'openDayId', v_day.id,
    'openWorkerCount', v_worker_count,
    'localDayStatus', v_local_day_status,
    'openDay', case when v_day.id is null then null else
      jsonb_build_object(
        'id', v_day.id, 'shopId', v_day.shop_id, 'status', 'OPEN',
        'startedAt', v_day.started_at,
        'startedByWorkerId', v_day.started_by_worker_id,
        'endedAt', null, 'endedByWorkerId', null,
        'lastAllocatedDisplayOrderNo', v_day.last_allocated_display_order_no
      )
    end
  );
end;
$$;
revoke all on function public.read_tux_operations_business_day_state_v2(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.read_tux_operations_business_day_state_v2(uuid,uuid,uuid)
  to service_role;

alter table public.worker_sessions
  add column if not exists last_seen_at timestamptz;

update public.worker_sessions
set last_seen_at = coalesce(ended_at, started_at)
where last_seen_at is null;

alter table public.worker_sessions
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

create index if not exists worker_sessions_open_lease_idx
  on public.worker_sessions(shop_id, business_day_id, last_seen_at)
  where ended_at is null;

create or replace function public.touch_tux_operations_worker_session_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_business_day_id uuid,
  p_worker_session_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare v_shop_id uuid; v_touched integer;
begin
  select d.shop_id into v_shop_id
  from public.devices d
  join public.shop_memberships m
    on m.shop_id = d.shop_id and m.auth_user_id = d.auth_user_id
  where d.id = p_device_id and d.auth_user_id = p_auth_user_id
    and d.active and m.active and m.role = 'OPERATIONS_DEVICE';
  if v_shop_id is null then raise exception 'TUX_DEVICE_NOT_AUTHORIZED'; end if;

  update public.worker_sessions ws
  set device_id = p_device_id, last_seen_at = clock_timestamp()
  where ws.id = p_worker_session_id
    and ws.shop_id = v_shop_id
    and ws.business_day_id = p_business_day_id
    and ws.ended_at is null
    and (ws.device_id is null or ws.device_id = p_device_id);
  get diagnostics v_touched = row_count;
  if v_touched <> 1 then raise exception 'TUX_WORKER_SESSION_NOT_ACTIVE'; end if;
  return jsonb_build_object('status','TOUCHED');
end;
$$;

revoke all on function public.touch_tux_operations_worker_session_v1(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.touch_tux_operations_worker_session_v1(uuid,uuid,uuid,uuid)
  to service_role;

create or replace function public.prepare_tux_operations_worker_exit_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_business_day_id uuid,
  p_worker_session_id uuid
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare
  v_shop_id uuid;
  v_session public.worker_sessions%rowtype;
  v_remaining bigint;
  v_now timestamptz := clock_timestamp();
begin
  select d.shop_id into v_shop_id
  from public.devices d
  join public.shop_memberships m
    on m.shop_id = d.shop_id and m.auth_user_id = d.auth_user_id
  where d.id = p_device_id and d.auth_user_id = p_auth_user_id
    and d.active and m.active and m.role = 'OPERATIONS_DEVICE';
  if v_shop_id is null then raise exception 'TUX_DEVICE_NOT_AUTHORIZED'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'tux:worker-exit:' || v_shop_id::text || ':' || p_business_day_id::text, 0
  ));
  perform 1 from public.business_days bd
  where bd.id = p_business_day_id and bd.shop_id = v_shop_id and bd.status = 'OPEN'
  for update;
  if not found then raise exception 'TUX_BUSINESS_DAY_NOT_OPEN'; end if;

  select ws.* into v_session from public.worker_sessions ws
  where ws.id = p_worker_session_id
    and ws.shop_id = v_shop_id
    and ws.business_day_id = p_business_day_id
  for update;
  if v_session.id is null or v_session.ended_at is not null then
    raise exception 'TUX_WORKER_SESSION_NOT_ACTIVE';
  end if;
  if v_session.device_id is not null and v_session.device_id <> p_device_id then
    raise exception 'TUX_WORKER_SESSION_DEVICE_CONFLICT';
  end if;

  update public.worker_sessions
  set device_id = p_device_id, last_seen_at = v_now
  where id = p_worker_session_id;

  update public.worker_sessions ws
  set ended_at = greatest(ws.started_at, ws.last_seen_at)
  where ws.shop_id = v_shop_id
    and ws.business_day_id = p_business_day_id
    and ws.id <> p_worker_session_id
    and ws.ended_at is null
    and ws.last_seen_at < v_now - interval '5 minutes';

  select count(*) into v_remaining
  from public.worker_sessions ws
  where ws.shop_id = v_shop_id
    and ws.business_day_id = p_business_day_id
    and ws.id <> p_worker_session_id
    and ws.ended_at is null;

  if v_remaining = 0 then
    return jsonb_build_object(
      'decision','END_DAY_REQUIRED',
      'remainingOpenSessionCount',0
    );
  end if;

  update public.worker_sessions
  set ended_at = greatest(started_at, v_now), last_seen_at = v_now
  where id = p_worker_session_id;
  return jsonb_build_object(
    'decision','SIGNED_OUT',
    'remainingOpenSessionCount',v_remaining
  );
end;
$$;

revoke all on function public.prepare_tux_operations_worker_exit_v1(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_tux_operations_worker_exit_v1(uuid,uuid,uuid,uuid)
  to service_role;

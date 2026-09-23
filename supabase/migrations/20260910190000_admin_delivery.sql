-- TUX Admin Plan 5: delivery routing authority and rider lifecycle.
-- Repository-only migration. Production promotion is a separate checkpoint.

alter table public.delivery_zones
  add column if not exists boundary_json jsonb,
  add column if not exists priority integer not null default 0,
  add column if not exists minimum_order_minor bigint not null default 0,
  add column if not exists fallback_shop_id uuid,
  add column if not exists fallback_enabled boolean not null default false;

alter table public.delivery_zones
  drop constraint if exists delivery_zones_minimum_order_minor_check;
alter table public.delivery_zones
  add constraint delivery_zones_minimum_order_minor_check
  check (minimum_order_minor >= 0);

alter table public.delivery_zones
  drop constraint if exists delivery_zones_fallback_coherent_check;
alter table public.delivery_zones
  add constraint delivery_zones_fallback_coherent_check
  check (
    (fallback_enabled and fallback_shop_id is not null) or
    (not fallback_enabled)
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.delivery_zones'::regclass
      and conname = 'delivery_zones_fallback_shop_fk'
  ) then
    alter table public.delivery_zones
      add constraint delivery_zones_fallback_shop_fk
      foreign key (fallback_shop_id)
      references public.shops(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists delivery_zones_routing_idx
  on public.delivery_zones(shop_id, active, priority desc, sort_order, id);
create index if not exists delivery_zones_fallback_idx
  on public.delivery_zones(fallback_shop_id)
  where fallback_enabled;

create table if not exists public.delivery_riders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  phone text,
  active boolean not null default true,
  state text not null default 'AVAILABLE'
    check (state in ('AVAILABLE', 'UNAVAILABLE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create index if not exists delivery_riders_shop_idx
  on public.delivery_riders(business_id, shop_id, active, state, display_name);

create table if not exists public.delivery_order_states (
  order_id uuid primary key references public.orders(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  rider_id uuid references public.delivery_riders(id) on delete restrict,
  state text not null default 'UNASSIGNED'
    check (
      state in (
        'UNASSIGNED',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'FAILED',
        'RETURNED'
      )
    ),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create index if not exists delivery_order_states_shop_idx
  on public.delivery_order_states(business_id, shop_id, state, updated_at desc);

create table if not exists public.delivery_order_state_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  rider_id uuid references public.delivery_riders(id) on delete restrict,
  from_state text
    check (
      from_state is null or
      from_state in (
        'UNASSIGNED',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'FAILED',
        'RETURNED'
      )
    ),
  to_state text not null
    check (
      to_state in (
        'UNASSIGNED',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'FAILED',
        'RETURNED'
      )
    ),
  employee_id uuid not null,
  note text,
  command_id text not null check (btrim(command_id) <> ''),
  created_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  unique (business_id, command_id)
);

create index if not exists delivery_order_state_events_order_idx
  on public.delivery_order_state_events(order_id, created_at, id);

alter table public.delivery_riders enable row level security;
alter table public.delivery_order_states enable row level security;
alter table public.delivery_order_state_events enable row level security;

revoke all on public.delivery_riders from public, anon, authenticated;
revoke all on public.delivery_order_states from public, anon, authenticated;
revoke all on public.delivery_order_state_events from public, anon, authenticated;

create or replace function private.assert_admin_delivery_permission_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_authorized boolean;
  v_business_id uuid;
begin
  select r.authorized, r.business_id
    into v_authorized, v_business_id
  from public.resolve_admin_authorization_v1(
    p_employee_id,
    p_shop_id,
    p_permission
  ) r;

  if not coalesce(v_authorized, false) or v_business_id is null then
    raise exception 'TUX_ADMIN_DELIVERY_PERMISSION_REQUIRED';
  end if;
  return v_business_id;
end;
$$;

revoke all on function private.assert_admin_delivery_permission_v1(
  uuid,
  uuid,
  text
) from public, anon, authenticated;

create or replace function public.transition_admin_delivery_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_order_id uuid,
  p_rider_id uuid,
  p_expected_version bigint,
  p_to_state text,
  p_note text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_state public.delivery_order_states%rowtype;
  v_existing public.delivery_order_state_events%rowtype;
  v_next_rider_id uuid;
  v_valid boolean := false;
begin
  if btrim(coalesce(p_command_id, '')) = '' then
    raise exception 'TUX_ADMIN_DELIVERY_COMMAND_REQUIRED';
  end if;

  v_business_id := private.assert_admin_delivery_permission_v1(
    p_employee_id,
    p_shop_id,
    'delivery.manage'
  );

  select *
    into v_existing
  from public.delivery_order_state_events
  where business_id = v_business_id
    and command_id = p_command_id;

  if found then
    if v_existing.order_id <> p_order_id
       or v_existing.shop_id <> p_shop_id
       or v_existing.to_state <> p_to_state
       or v_existing.rider_id is distinct from p_rider_id
       or v_existing.note is distinct from p_note then
      return jsonb_build_object(
        'ok', false,
        'code', 'delivery_command_conflict'
      );
    end if;

    select *
      into v_state
    from public.delivery_order_states
    where order_id = p_order_id;

    return jsonb_build_object(
      'ok', true,
      'orderId', p_order_id,
      'state', v_existing.to_state,
      'version', coalesce(v_state.version, 1),
      'replayed', true
    );
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id
    and shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;

  if v_order.order_type_behavior_snapshot <> 'DELIVERY' then
    return jsonb_build_object('ok', false, 'code', 'order_not_delivery');
  end if;

  select *
    into v_state
  from public.delivery_order_states
  where order_id = p_order_id
  for update;

  if not found then
    insert into public.delivery_order_states (
      order_id,
      business_id,
      shop_id,
      rider_id,
      state,
      version
    ) values (
      p_order_id,
      v_business_id,
      p_shop_id,
      null,
      'UNASSIGNED',
      1
    )
    returning * into v_state;

    insert into public.delivery_order_state_events (
      business_id,
      shop_id,
      order_id,
      rider_id,
      from_state,
      to_state,
      employee_id,
      note,
      command_id
    ) values (
      v_business_id,
      p_shop_id,
      p_order_id,
      null,
      null,
      'UNASSIGNED',
      p_employee_id,
      null,
      p_command_id || ':init'
    );
  end if;

  if v_state.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_delivery_version',
      'currentVersion', v_state.version
    );
  end if;

  v_valid := case v_state.state
    when 'UNASSIGNED' then p_to_state = 'ASSIGNED'
    when 'ASSIGNED' then p_to_state in ('UNASSIGNED', 'OUT_FOR_DELIVERY')
    when 'OUT_FOR_DELIVERY' then p_to_state in (
      'DELIVERED',
      'FAILED',
      'RETURNED'
    )
    else false
  end;

  if not v_valid then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_delivery_transition'
    );
  end if;

  if p_to_state = 'ASSIGNED' then
    if p_rider_id is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'rider_required'
      );
    end if;

    perform 1
    from public.delivery_riders r
    where r.id = p_rider_id
      and r.business_id = v_business_id
      and r.shop_id = p_shop_id
      and r.active
      and r.state = 'AVAILABLE'
    for update;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'code', 'rider_unavailable'
      );
    end if;
    v_next_rider_id := p_rider_id;
  elsif p_to_state = 'UNASSIGNED' then
    v_next_rider_id := null;
  else
    v_next_rider_id := v_state.rider_id;
    if v_next_rider_id is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'rider_required'
      );
    end if;
    if p_rider_id is not null and p_rider_id <> v_next_rider_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'rider_conflict'
      );
    end if;
  end if;

  update public.delivery_order_states
  set
    rider_id = v_next_rider_id,
    state = p_to_state,
    version = version + 1,
    updated_at = now()
  where order_id = p_order_id
  returning * into v_state;

  insert into public.delivery_order_state_events (
    business_id,
    shop_id,
    order_id,
    rider_id,
    from_state,
    to_state,
    employee_id,
    note,
    command_id
  ) values (
    v_business_id,
    p_shop_id,
    p_order_id,
    v_next_rider_id,
    case
      when p_to_state = 'UNASSIGNED' then 'ASSIGNED'
      else (
        select e.to_state
        from public.delivery_order_state_events e
        where e.order_id = p_order_id
          and e.command_id <> p_command_id || ':init'
        order by e.created_at desc, e.id desc
        limit 1
      )
    end,
    p_to_state,
    p_employee_id,
    nullif(btrim(coalesce(p_note, '')), ''),
    p_command_id
  );

  return jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'state', p_to_state,
    'version', v_state.version,
    'replayed', false
  );
end;
$$;

revoke all on function public.transition_admin_delivery_order_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.transition_admin_delivery_order_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  text,
  text,
  text
) to service_role;

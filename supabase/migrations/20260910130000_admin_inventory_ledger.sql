-- TUX Admin Plan 4: additive inventory ledger, reservation, stocktake, and transfer foundation.
-- Existing Operations inventory_movements rows and movement labels remain authoritative history.

alter table public.inventory_movements
  add column if not exists reserved_delta_micros bigint not null default 0,
  add column if not exists admin_employee_id uuid references public.business_employees(id) on delete restrict,
  add column if not exists source_kind text not null default 'OPERATIONS',
  add column if not exists command_id text,
  add column if not exists unit_cost_minor numeric(20, 6),
  add column if not exists reason_code_id uuid references public.admin_reason_codes(id) on delete restrict,
  add column if not exists reason_code_key text,
  add column if not exists reason_label_snapshot text,
  add column if not exists reason_family_snapshot text,
  add column if not exists reason_config_version bigint,
  add column if not exists note text,
  add column if not exists emergency_negative_override boolean not null default false;

alter table public.inventory_movements
  alter column worker_id drop not null;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check,
  drop constraint if exists inventory_movements_quantity_delta_micros_check,
  drop constraint if exists inventory_movements_effect_ck,
  drop constraint if exists inventory_movements_source_kind_ck,
  drop constraint if exists inventory_movements_actor_ck,
  drop constraint if exists inventory_movements_reason_snapshot_ck,
  drop constraint if exists inventory_movements_cost_ck;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (
    movement_type in (
      'ORDER_CONSUMPTION',
      'CANCEL_RESTOCK',
      'BULK_UNIT_FINISHED',
      'BULK_STOCK_RECEIVED',
      'UNDO_BULK_UNIT_FINISHED',
      'UNDO_BULK_STOCK_RECEIVED',
      'ADMIN_ADJUSTMENT',
      'ORDER_RESERVATION',
      'ORDER_RESERVATION_RELEASE',
      'ORDER_CONSUMPTION_REVERSAL',
      'WASTE',
      'STOCKTAKE_ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'PURCHASE_RECEIPT',
      'PURCHASE_RETURN'
    )
  ),
  add constraint inventory_movements_effect_ck check (
    quantity_delta_micros <> 0 or reserved_delta_micros <> 0
  ),
  add constraint inventory_movements_source_kind_ck check (
    source_kind in ('OPERATIONS', 'ADMIN', 'SYSTEM')
  ),
  add constraint inventory_movements_actor_ck check (
    (source_kind = 'OPERATIONS' and worker_id is not null)
    or (source_kind = 'ADMIN' and admin_employee_id is not null)
    or source_kind = 'SYSTEM'
  ),
  add constraint inventory_movements_reason_snapshot_ck check (
    (reason_code_id is null
      and reason_code_key is null
      and reason_label_snapshot is null
      and reason_family_snapshot is null
      and reason_config_version is null)
    or
    (reason_code_id is not null
      and reason_code_key is not null
      and reason_label_snapshot is not null
      and reason_family_snapshot is not null
      and reason_config_version is not null)
  ),
  add constraint inventory_movements_cost_ck check (
    unit_cost_minor is null or unit_cost_minor >= 0
  );

create index if not exists inventory_movements_command_idx
  on public.inventory_movements(shop_id, command_id)
  where command_id is not null;

create index if not exists inventory_movements_order_item_idx
  on public.inventory_movements(order_id, inventory_item_id, created_at)
  where order_id is not null;

create table public.inventory_movement_feed (
  sequence bigint generated always as identity primary key,
  movement_id uuid not null unique references public.inventory_movements(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  captured_at timestamptz not null default now()
);
create index inventory_movement_feed_shop_sequence_idx
  on public.inventory_movement_feed(shop_id, sequence);

insert into public.inventory_movement_feed(movement_id, shop_id)
select m.id, m.shop_id
from public.inventory_movements m
order by m.created_at, m.id;

create or replace function private.capture_inventory_movement_feed_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $inventory_feed$
begin
  insert into public.inventory_movement_feed(movement_id, shop_id)
  values (new.id, new.shop_id)
  on conflict (movement_id) do nothing;
  return new;
end;
$inventory_feed$;

revoke all on function private.capture_inventory_movement_feed_v1()
  from public, anon, authenticated;

create trigger inventory_movements_capture_feed
after insert on public.inventory_movements
for each row execute function private.capture_inventory_movement_feed_v1();

create table public.inventory_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  purchase_unit_label text not null check (btrim(purchase_unit_label) <> ''),
  base_micros_per_purchase_unit bigint not null check (base_micros_per_purchase_unit > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inventory_item_id, purchase_unit_label)
);
create index inventory_unit_conversions_shop_item_idx
  on public.inventory_unit_conversions(shop_id, inventory_item_id, active);

create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  business_day_id uuid references public.business_days(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_micros bigint not null check (quantity_micros > 0),
  status text not null check (status in ('ACTIVE', 'CONSUMED', 'RELEASED')),
  reserve_command_id text not null check (btrim(reserve_command_id) <> ''),
  last_command_id text not null check (btrim(last_command_id) <> ''),
  created_by_worker_id uuid references public.workers(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, order_id, inventory_item_id)
);
create index inventory_reservations_shop_status_idx
  on public.inventory_reservations(shop_id, status, inventory_item_id);
create index inventory_reservations_order_idx
  on public.inventory_reservations(order_id, status);

create table public.inventory_cost_state (
  shop_id uuid not null references public.shops(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  weighted_unit_cost_minor numeric(20, 6) not null default 0
    check (weighted_unit_cost_minor >= 0),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, inventory_item_id)
);

create table public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  status text not null check (status in ('DRAFT', 'POSTED', 'CANCELLED')),
  command_id text not null check (btrim(command_id) <> ''),
  post_command_id text,
  started_at timestamptz not null default now(),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, command_id),
  unique (shop_id, post_command_id),
  check (post_command_id is null or btrim(post_command_id) <> ''),
  check ((status = 'POSTED') = (posted_at is not null)),
  check ((status = 'POSTED') = (post_command_id is not null))
);

create table public.stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.stocktakes(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  snapshot_on_hand_micros bigint not null,
  snapshot_reserved_micros bigint not null check (snapshot_reserved_micros >= 0),
  actual_count_micros bigint check (actual_count_micros is null or actual_count_micros >= 0),
  variance_micros bigint,
  unit_cost_minor numeric(20, 6) not null default 0 check (unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  unique (stocktake_id, inventory_item_id),
  check (
    (actual_count_micros is null and variance_micros is null)
    or (
      actual_count_micros is not null
      and variance_micros = actual_count_micros - snapshot_on_hand_micros
    )
  )
);

create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  source_shop_id uuid not null references public.shops(id) on delete restrict,
  destination_shop_id uuid not null references public.shops(id) on delete restrict,
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  status text not null check (status in ('SENT', 'RECEIVED', 'CANCELLED')),
  send_command_id text not null check (btrim(send_command_id) <> ''),
  receive_command_id text,
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_shop_id, send_command_id),
  check (source_shop_id <> destination_shop_id),
  check (
    (status = 'RECEIVED' and received_at is not null and receive_command_id is not null)
    or (status <> 'RECEIVED' and received_at is null)
  )
);
create unique index stock_transfers_receive_command_uq
  on public.stock_transfers(destination_shop_id, receive_command_id)
  where receive_command_id is not null;

create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  destination_inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_micros bigint not null check (quantity_micros > 0),
  source_unit_cost_minor numeric(20, 6) not null default 0 check (source_unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  unique (transfer_id, inventory_item_id)
);

alter table public.inventory_movement_feed enable row level security;
alter table public.inventory_unit_conversions enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.inventory_cost_state enable row level security;
alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;

revoke all on public.inventory_movement_feed from public, anon, authenticated;
revoke all on public.inventory_unit_conversions from public, anon, authenticated;
revoke all on public.inventory_reservations from public, anon, authenticated;
revoke all on public.inventory_cost_state from public, anon, authenticated;
revoke all on public.stocktakes from public, anon, authenticated;
revoke all on public.stocktake_lines from public, anon, authenticated;
revoke all on public.stock_transfers from public, anon, authenticated;
revoke all on public.stock_transfer_lines from public, anon, authenticated;

grant select on public.inventory_movement_feed to service_role;
grant usage, select on sequence public.inventory_movement_feed_sequence_seq to service_role;
grant select, insert, update, delete on public.inventory_unit_conversions to service_role;
grant select, insert, update, delete on public.inventory_reservations to service_role;
grant select, insert, update, delete on public.inventory_cost_state to service_role;
grant select, insert, update, delete on public.stocktakes to service_role;
grant select, insert, update, delete on public.stocktake_lines to service_role;
grant select, insert, update, delete on public.stock_transfers to service_role;
grant select, insert, update, delete on public.stock_transfer_lines to service_role;

create or replace function private.inventory_balance_v1(
  p_shop_id uuid,
  p_inventory_item_id uuid
)
returns table(
  on_hand_micros bigint,
  reserved_micros bigint,
  available_micros bigint
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    coalesce(sum(m.quantity_delta_micros), 0)::bigint as on_hand_micros,
    coalesce(sum(m.reserved_delta_micros), 0)::bigint as reserved_micros,
    (
      coalesce(sum(m.quantity_delta_micros), 0)
      - coalesce(sum(m.reserved_delta_micros), 0)
    )::bigint as available_micros
  from public.inventory_movements m
  where m.shop_id = p_shop_id
    and m.inventory_item_id = p_inventory_item_id
$$;

revoke all on function private.inventory_balance_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.enforce_inventory_order_reservation_capacity_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $reservation_capacity$
declare
  v_available bigint;
  v_order_reserved numeric(20, 0);
  v_required_capacity numeric(20, 0);
begin
  if new.movement_type = 'ORDER_RESERVATION'
     and coalesce(new.reserved_delta_micros, 0) > 0 then
    v_required_capacity := new.reserved_delta_micros;
  elsif new.movement_type = 'ORDER_CONSUMPTION'
     and coalesce(new.reserved_delta_micros, 0) = 0
     and new.quantity_delta_micros < 0 then
    v_required_capacity := -(new.quantity_delta_micros::numeric);
  elsif coalesce(new.reserved_delta_micros, 0) <> 0 then
    v_required_capacity := null;
  else
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || new.shop_id::text || ':' || new.inventory_item_id::text,
      0
    )
  );

  select b.available_micros
    into v_available
  from private.inventory_balance_v1(new.shop_id, new.inventory_item_id) b;

  if coalesce(new.reserved_delta_micros, 0) < 0 then
    if new.order_id is null then
      raise exception 'TUX_INVENTORY_RESERVATION_UNDERFLOW';
    end if;

    select coalesce(sum(m.reserved_delta_micros), 0)
      into v_order_reserved
    from public.inventory_movements m
    where m.shop_id = new.shop_id
      and m.inventory_item_id = new.inventory_item_id
      and m.order_id = new.order_id;

    if v_order_reserved < -(new.reserved_delta_micros::numeric) then
      raise exception 'TUX_INVENTORY_RESERVATION_UNDERFLOW';
    end if;
  end if;

  if v_required_capacity is not null and v_available < v_required_capacity then
    raise exception 'TUX_INVENTORY_INSUFFICIENT_STOCK';
  end if;

  return new;
end;
$reservation_capacity$;

revoke all on function private.enforce_inventory_order_reservation_capacity_v1()
  from public, anon, authenticated;

create trigger inventory_movements_reservation_capacity
before insert on public.inventory_movements
for each row execute function private.enforce_inventory_order_reservation_capacity_v1();

create or replace function private.bind_order_consumption_cost_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $order_consumption_cost$
declare
  v_unit_cost numeric(20, 6);
begin
  if new.movement_type is distinct from 'ORDER_CONSUMPTION' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.movement_type = 'ORDER_CONSUMPTION'
     and old.inventory_item_id = new.inventory_item_id then
    new.unit_cost_minor := old.unit_cost_minor;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || new.shop_id::text || ':' || new.inventory_item_id::text,
      0
    )
  );

  select c.weighted_unit_cost_minor
    into v_unit_cost
  from public.inventory_cost_state c
  where c.shop_id = new.shop_id
    and c.inventory_item_id = new.inventory_item_id;

  new.unit_cost_minor := coalesce(v_unit_cost, 0);
  return new;
end;
$order_consumption_cost$;

revoke all on function private.bind_order_consumption_cost_v1()
  from public, anon, authenticated;

create trigger inventory_movements_bind_order_consumption_cost
before insert or update of movement_type, inventory_item_id, unit_cost_minor
on public.inventory_movements
for each row execute function private.bind_order_consumption_cost_v1();

create or replace function private.assert_inventory_item_shop_v1(
  p_shop_id uuid,
  p_inventory_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.inventory_items i
    where i.id = p_inventory_item_id
      and i.shop_id = p_shop_id
      and i.active
  ) then
    raise exception 'TUX_INVENTORY_ITEM_NOT_FOUND';
  end if;
end;
$$;

revoke all on function private.assert_inventory_item_shop_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.admin_inventory_authority_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns table(
  business_id uuid,
  employee_role text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_authorized boolean;
  v_business_id uuid;
  v_role text;
begin
  select a.authorized, a.business_id, a.employee_role
    into v_authorized, v_business_id, v_role
  from public.resolve_admin_authorization_v1(
    p_employee_id,
    p_shop_id,
    p_permission
  ) a
  limit 1;

  if not coalesce(v_authorized, false) then
    raise exception 'TUX_ADMIN_INVENTORY_PERMISSION_REQUIRED';
  end if;

  return query select v_business_id, v_role;
end;
$$;

revoke all on function private.admin_inventory_authority_v1(uuid, uuid, text)
  from public, anon, authenticated;


create or replace function public.read_admin_inventory_balances_v1(
  p_employee_id uuid,
  p_shop_id uuid
)
returns table(
  inventory_item_id uuid,
  on_hand_micros bigint,
  reserved_micros bigint,
  available_micros bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $inventory_balances$
begin
  perform 1
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.view'
  );

  return query
  select
    i.id,
    b.on_hand_micros,
    b.reserved_micros,
    b.available_micros
  from public.inventory_items i
  cross join lateral private.inventory_balance_v1(p_shop_id, i.id) b
  where i.shop_id = p_shop_id
  order by i.id;
end;
$inventory_balances$;

revoke all on function public.read_admin_inventory_balances_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_admin_inventory_balances_v1(uuid, uuid)
  to service_role;

create or replace function private.inventory_reason_snapshot_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_reason_code_id uuid,
  p_family text
)
returns table(
  reason_code_key text,
  reason_label text,
  reason_family text,
  reason_version bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  select r.reason_key, r.label, r.family, r.version
  from public.admin_reason_codes r
  where r.id = p_reason_code_id
    and r.business_id = p_business_id
    and (r.shop_id is null or r.shop_id = p_shop_id)
    and r.active
    and r.family = p_family
  limit 1;

  if not found then
    raise exception 'TUX_ADMIN_INVENTORY_REASON_INVALID';
  end if;
end;
$$;

revoke all on function private.inventory_reason_snapshot_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.reserve_inventory_for_order_v1(
  p_shop_id uuid,
  p_order_id uuid,
  p_business_day_id uuid,
  p_worker_id uuid,
  p_requirements jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_line jsonb;
  v_item_id uuid;
  v_quantity bigint;
  v_available bigint;
  v_existing integer;
begin
  if p_shop_id is null
     or p_order_id is null
     or p_worker_id is null
     or p_requirements is null
     or jsonb_typeof(p_requirements) <> 'array'
     or jsonb_array_length(p_requirements) = 0
     or p_command_id is null
     or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_reservation_command');
  end if;

  if not exists (
    select 1 from public.workers w
    where w.id = p_worker_id and w.shop_id = p_shop_id and w.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;
  if not exists (
    select 1 from public.orders o where o.id = p_order_id and o.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if p_business_day_id is not null and not exists (
    select 1 from public.business_days d
    where d.id = p_business_day_id and d.shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'business_day_not_found');
  end if;

  select count(*) into v_existing
  from public.inventory_reservations r
  where r.shop_id = p_shop_id
    and r.order_id = p_order_id
    and r.reserve_command_id = p_command_id;
  if v_existing = jsonb_array_length(p_requirements) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  for v_line in
    select value
    from jsonb_array_elements(p_requirements)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_quantity := (v_line ->> 'quantityMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_reservation_line');
    end;
    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_reservation_line');
    end if;

    perform private.assert_inventory_item_shop_v1(p_shop_id, v_item_id);
    perform pg_advisory_xact_lock(
      hashtextextended('tux-inventory:' || p_shop_id::text || ':' || v_item_id::text, 0)
    );

    if exists (
      select 1 from public.inventory_reservations r
      where r.shop_id = p_shop_id
        and r.order_id = p_order_id
        and r.inventory_item_id = v_item_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'reservation_conflict');
    end if;

    select b.available_micros into v_available
    from private.inventory_balance_v1(p_shop_id, v_item_id) b;

    if v_available < v_quantity then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'inventoryItemId', v_item_id,
        'availableMicros', v_available
      );
    end if;
  end loop;

  for v_line in
    select value
    from jsonb_array_elements(p_requirements)
    order by value ->> 'inventoryItemId'
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_quantity := (v_line ->> 'quantityMicros')::bigint;

    insert into public.inventory_reservations(
      shop_id,
      business_day_id,
      order_id,
      inventory_item_id,
      quantity_micros,
      status,
      reserve_command_id,
      last_command_id,
      created_by_worker_id
    ) values (
      p_shop_id,
      p_business_day_id,
      p_order_id,
      v_item_id,
      v_quantity,
      'ACTIVE',
      p_command_id,
      p_command_id,
      p_worker_id
    );

    insert into public.inventory_movements(
      id,
      shop_id,
      business_day_id,
      inventory_item_id,
      movement_type,
      quantity_delta_micros,
      reserved_delta_micros,
      worker_id,
      order_id,
      compensates_movement_id,
      idempotency_key,
      source_kind,
      command_id,
      created_at
    ) values (
      gen_random_uuid(),
      p_shop_id,
      p_business_day_id,
      v_item_id,
      'ORDER_RESERVATION',
      0,
      v_quantity,
      p_worker_id,
      p_order_id,
      null,
      'order-reservation:' || p_command_id || ':' || v_item_id::text,
      'OPERATIONS',
      p_command_id,
      now()
    );
  end loop;

  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$$;

create or replace function public.consume_inventory_for_order_v1(
  p_shop_id uuid,
  p_order_id uuid,
  p_worker_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.inventory_reservations%rowtype;
  v_count integer := 0;
begin
  if p_shop_id is null or p_order_id is null or p_worker_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_consumption_command');
  end if;
  if not exists (
    select 1 from public.workers w
    where w.id = p_worker_id and w.shop_id = p_shop_id and w.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;

  if exists (
    select 1 from public.inventory_reservations r
    where r.shop_id = p_shop_id and r.order_id = p_order_id
      and r.status = 'CONSUMED' and r.last_command_id = p_command_id
  ) and not exists (
    select 1 from public.inventory_reservations r
    where r.shop_id = p_shop_id and r.order_id = p_order_id and r.status = 'ACTIVE'
  ) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  for v_row in
    select r.*
    from public.inventory_reservations r
    where r.shop_id = p_shop_id
      and r.order_id = p_order_id
      and r.status = 'ACTIVE'
    order by r.inventory_item_id
    for update
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_row.inventory_item_id::text,
        0
      )
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, source_kind, command_id, created_at
    ) values (
      gen_random_uuid(), p_shop_id, v_row.business_day_id, v_row.inventory_item_id,
      'ORDER_CONSUMPTION', -v_row.quantity_micros, -v_row.quantity_micros,
      p_worker_id, p_order_id, null,
      'order-consumption:' || p_command_id || ':' || v_row.inventory_item_id::text,
      'OPERATIONS', p_command_id, now()
    );

    update public.inventory_reservations
    set status = 'CONSUMED', last_command_id = p_command_id, updated_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'reservation_not_active');
  end if;
  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$$;

create or replace function public.restore_order_reservation_v1(
  p_shop_id uuid,
  p_order_id uuid,
  p_worker_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.inventory_reservations%rowtype;
  v_count integer := 0;
begin
  if p_shop_id is null or p_order_id is null or p_worker_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_restore_command');
  end if;
  if not exists (
    select 1 from public.workers w
    where w.id = p_worker_id and w.shop_id = p_shop_id and w.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;

  if exists (
    select 1 from public.inventory_reservations r
    where r.shop_id = p_shop_id and r.order_id = p_order_id
      and r.status = 'ACTIVE' and r.last_command_id = p_command_id
  ) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  for v_row in
    select r.*
    from public.inventory_reservations r
    where r.shop_id = p_shop_id
      and r.order_id = p_order_id
      and r.status = 'CONSUMED'
    order by r.inventory_item_id
    for update
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_row.inventory_item_id::text,
        0
      )
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, source_kind, command_id, created_at
    ) values (
      gen_random_uuid(), p_shop_id, v_row.business_day_id, v_row.inventory_item_id,
      'ORDER_CONSUMPTION_REVERSAL', v_row.quantity_micros, v_row.quantity_micros,
      p_worker_id, p_order_id, null,
      'order-consumption-reversal:' || p_command_id || ':' || v_row.inventory_item_id::text,
      'OPERATIONS', p_command_id, now()
    );

    update public.inventory_reservations
    set status = 'ACTIVE', last_command_id = p_command_id, updated_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'reservation_not_consumed');
  end if;
  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$$;

create or replace function public.release_inventory_for_order_v1(
  p_shop_id uuid,
  p_order_id uuid,
  p_worker_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row public.inventory_reservations%rowtype;
  v_count integer := 0;
begin
  if p_shop_id is null or p_order_id is null or p_worker_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_release_command');
  end if;
  if not exists (
    select 1 from public.workers w
    where w.id = p_worker_id and w.shop_id = p_shop_id and w.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;

  if exists (
    select 1 from public.inventory_reservations r
    where r.shop_id = p_shop_id and r.order_id = p_order_id
      and r.status = 'RELEASED' and r.last_command_id = p_command_id
  ) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  for v_row in
    select r.*
    from public.inventory_reservations r
    where r.shop_id = p_shop_id
      and r.order_id = p_order_id
      and r.status = 'ACTIVE'
    order by r.inventory_item_id
    for update
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_row.inventory_item_id::text,
        0
      )
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, source_kind, command_id, created_at
    ) values (
      gen_random_uuid(), p_shop_id, v_row.business_day_id, v_row.inventory_item_id,
      'ORDER_RESERVATION_RELEASE', 0, -v_row.quantity_micros,
      p_worker_id, p_order_id, null,
      'order-reservation-release:' || p_command_id || ':' || v_row.inventory_item_id::text,
      'OPERATIONS', p_command_id, now()
    );

    update public.inventory_reservations
    set status = 'RELEASED', last_command_id = p_command_id, updated_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'reservation_not_active');
  end if;
  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$$;

create or replace function public.post_inventory_adjustment_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_id uuid,
  p_quantity_delta_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_role text;
  v_reason_key text;
  v_reason_label text;
  v_reason_family text;
  v_reason_version bigint;
  v_on_hand bigint;
  v_reserved bigint;
  v_available bigint;
  v_new_available bigint;
  v_override_authorized boolean;
  v_movement_id uuid;
begin
  if p_employee_id is null or p_shop_id is null or p_inventory_item_id is null
     or p_quantity_delta_micros is null or p_quantity_delta_micros = 0
     or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_adjustment_command');
  end if;

  if exists (
    select 1 from public.inventory_movements m
    where m.shop_id = p_shop_id
      and m.source_kind = 'ADMIN'
      and m.command_id = p_command_id
      and m.movement_type = 'ADMIN_ADJUSTMENT'
  ) then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;

  select a.business_id, a.employee_role
    into v_business_id, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.adjust'
  ) a;

  perform private.assert_inventory_item_shop_v1(p_shop_id, p_inventory_item_id);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || p_shop_id::text || ':' || p_inventory_item_id::text,
      0
    )
  );

  select r.reason_code_key, r.reason_label, r.reason_family, r.reason_version
    into v_reason_key, v_reason_label, v_reason_family, v_reason_version
  from private.inventory_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'STOCK_ADJUSTMENT'
  ) r;

  select b.on_hand_micros, b.reserved_micros, b.available_micros
    into v_on_hand, v_reserved, v_available
  from private.inventory_balance_v1(p_shop_id, p_inventory_item_id) b;

  v_new_available := v_on_hand + p_quantity_delta_micros - v_reserved;
  if v_new_available < 0 then
    if not coalesce(p_emergency_negative_override, false) then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'availableMicros', v_available
      );
    end if;

    if v_role <> 'OWNER' or p_note is null or btrim(p_note) = '' then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;

    select a.authorized into v_override_authorized
    from public.resolve_admin_authorization_v1(
      p_employee_id, p_shop_id, 'inventory.override_negative'
    ) a
    limit 1;
    if not coalesce(v_override_authorized, false) then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;
  end if;

  v_movement_id := gen_random_uuid();
  insert into public.inventory_movements(
    id,
    shop_id,
    business_day_id,
    inventory_item_id,
    movement_type,
    quantity_delta_micros,
    reserved_delta_micros,
    worker_id,
    order_id,
    compensates_movement_id,
    idempotency_key,
    admin_employee_id,
    source_kind,
    command_id,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    emergency_negative_override,
    created_at
  ) values (
    v_movement_id,
    p_shop_id,
    null,
    p_inventory_item_id,
    'ADMIN_ADJUSTMENT',
    p_quantity_delta_micros,
    0,
    null,
    null,
    null,
    'admin-adjustment:' || p_command_id,
    p_employee_id,
    'ADMIN',
    p_command_id,
    p_reason_code_id,
    v_reason_key,
    v_reason_label,
    v_reason_family,
    v_reason_version,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_emergency_negative_override, false),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'movementId', v_movement_id,
    'onHandMicros', v_on_hand + p_quantity_delta_micros,
    'reservedMicros', v_reserved,
    'availableMicros', v_new_available
  );
end;
$$;

create or replace function public.post_inventory_waste_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_id uuid,
  p_quantity_micros bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_emergency_negative_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $waste$
declare
  v_business_id uuid;
  v_role text;
  v_reason_key text;
  v_reason_label text;
  v_reason_family text;
  v_reason_version bigint;
  v_on_hand bigint;
  v_reserved bigint;
  v_available bigint;
  v_new_available bigint;
  v_override_authorized boolean;
  v_unit_cost numeric(20, 6);
  v_movement_id uuid;
begin
  if p_employee_id is null or p_shop_id is null or p_inventory_item_id is null
     or p_quantity_micros is null or p_quantity_micros <= 0
     or p_reason_code_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_waste_command');
  end if;

  select m.id into v_movement_id
  from public.inventory_movements m
  where m.shop_id = p_shop_id
    and m.source_kind = 'ADMIN'
    and m.command_id = p_command_id
    and m.movement_type = 'WASTE'
  limit 1;
  if v_movement_id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true, 'movementId', v_movement_id
    );
  end if;

  select a.business_id, a.employee_role
    into v_business_id, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.adjust'
  ) a;

  perform private.assert_inventory_item_shop_v1(p_shop_id, p_inventory_item_id);
  perform pg_advisory_xact_lock(
    hashtextextended(
      'tux-inventory:' || p_shop_id::text || ':' || p_inventory_item_id::text,
      0
    )
  );

  select r.reason_code_key, r.reason_label, r.reason_family, r.reason_version
    into v_reason_key, v_reason_label, v_reason_family, v_reason_version
  from private.inventory_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'WASTE'
  ) r;

  select b.on_hand_micros, b.reserved_micros, b.available_micros
    into v_on_hand, v_reserved, v_available
  from private.inventory_balance_v1(p_shop_id, p_inventory_item_id) b;

  v_new_available := v_on_hand - p_quantity_micros - v_reserved;
  if v_new_available < 0 then
    if not coalesce(p_emergency_negative_override, false) then
      return jsonb_build_object(
        'ok', false,
        'code', 'insufficient_stock',
        'availableMicros', v_available
      );
    end if;

    if v_role <> 'OWNER' or p_note is null or btrim(p_note) = '' then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;

    select a.authorized into v_override_authorized
    from public.resolve_admin_authorization_v1(
      p_employee_id, p_shop_id, 'inventory.override_negative'
    ) a
    limit 1;
    if not coalesce(v_override_authorized, false) then
      return jsonb_build_object('ok', false, 'code', 'emergency_override_forbidden');
    end if;
  end if;

  select coalesce(c.weighted_unit_cost_minor, 0)
    into v_unit_cost
  from public.inventory_cost_state c
  where c.shop_id = p_shop_id
    and c.inventory_item_id = p_inventory_item_id;
  v_unit_cost := coalesce(v_unit_cost, 0);

  v_movement_id := gen_random_uuid();
  insert into public.inventory_movements(
    id,
    shop_id,
    business_day_id,
    inventory_item_id,
    movement_type,
    quantity_delta_micros,
    reserved_delta_micros,
    worker_id,
    order_id,
    compensates_movement_id,
    idempotency_key,
    admin_employee_id,
    source_kind,
    command_id,
    unit_cost_minor,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    emergency_negative_override,
    created_at
  ) values (
    v_movement_id,
    p_shop_id,
    null,
    p_inventory_item_id,
    'WASTE',
    -p_quantity_micros,
    0,
    null,
    null,
    null,
    'inventory-waste:' || p_command_id,
    p_employee_id,
    'ADMIN',
    p_command_id,
    v_unit_cost,
    p_reason_code_id,
    v_reason_key,
    v_reason_label,
    v_reason_family,
    v_reason_version,
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_emergency_negative_override, false),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'movementId', v_movement_id,
    'onHandMicros', v_on_hand - p_quantity_micros,
    'reservedMicros', v_reserved,
    'availableMicros', v_new_available
  );
end;
$waste$;

create or replace function public.begin_stocktake_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_inventory_item_ids jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_stocktake_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_on_hand bigint;
  v_reserved bigint;
  v_unit_cost numeric(20, 6);
  v_lines jsonb;
begin
  if p_employee_id is null or p_shop_id is null
     or p_inventory_item_ids is null
     or jsonb_typeof(p_inventory_item_ids) <> 'array'
     or jsonb_array_length(p_inventory_item_ids) = 0
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_stocktake_begin_command');
  end if;

  perform 1
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.stocktake'
  );

  select s.id into v_stocktake_id
  from public.stocktakes s
  where s.shop_id = p_shop_id and s.command_id = p_command_id;

  if v_stocktake_id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'inventoryItemId', l.inventory_item_id,
          'snapshotOnHandMicros', l.snapshot_on_hand_micros,
          'snapshotReservedMicros', l.snapshot_reserved_micros,
          'unitCostMinor', l.unit_cost_minor
        )
        order by l.inventory_item_id
      ),
      '[]'::jsonb
    ) into v_lines
    from public.stocktake_lines l
    where l.stocktake_id = v_stocktake_id;

    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'stocktakeId', v_stocktake_id,
      'lines', v_lines
    );
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_inventory_item_ids)
    order by value #>> '{}'
  loop
    begin
      v_item_id := trim(both '"' from v_item::text)::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_stocktake_item');
    end;
    perform private.assert_inventory_item_shop_v1(p_shop_id, v_item_id);
    perform pg_advisory_xact_lock(
      hashtextextended('tux-inventory:' || p_shop_id::text || ':' || v_item_id::text, 0)
    );
  end loop;

  v_stocktake_id := gen_random_uuid();
  insert into public.stocktakes(
    id, shop_id, created_by_employee_id, status, command_id
  ) values (
    v_stocktake_id, p_shop_id, p_employee_id, 'DRAFT', p_command_id
  );

  for v_item in
    select value
    from jsonb_array_elements(p_inventory_item_ids)
    order by value #>> '{}'
  loop
    v_item_id := trim(both '"' from v_item::text)::uuid;

    select b.on_hand_micros, b.reserved_micros
      into v_on_hand, v_reserved
    from private.inventory_balance_v1(p_shop_id, v_item_id) b;

    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_unit_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_item_id;
    v_unit_cost := coalesce(v_unit_cost, 0);

    insert into public.stocktake_lines(
      stocktake_id,
      inventory_item_id,
      snapshot_on_hand_micros,
      snapshot_reserved_micros,
      actual_count_micros,
      variance_micros,
      unit_cost_minor
    ) values (
      v_stocktake_id,
      v_item_id,
      v_on_hand,
      v_reserved,
      null,
      null,
      v_unit_cost
    );
  end loop;

  select jsonb_agg(
    jsonb_build_object(
      'inventoryItemId', l.inventory_item_id,
      'snapshotOnHandMicros', l.snapshot_on_hand_micros,
      'snapshotReservedMicros', l.snapshot_reserved_micros,
      'unitCostMinor', l.unit_cost_minor
    )
    order by l.inventory_item_id
  ) into v_lines
  from public.stocktake_lines l
  where l.stocktake_id = v_stocktake_id;

  return jsonb_build_object(
    'ok', true,
    'idempotentReplay', false,
    'stocktakeId', v_stocktake_id,
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
end;
$$;

create or replace function public.post_stocktake_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_stocktake_id uuid,
  p_lines jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_stocktake public.stocktakes%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_actual bigint;
  v_snapshot_on_hand bigint;
  v_snapshot_reserved bigint;
  v_current_on_hand bigint;
  v_current_reserved bigint;
  v_delta bigint;
  v_unit_cost numeric(20, 6);
begin
  if p_employee_id is null or p_shop_id is null or p_stocktake_id is null
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_stocktake_post_command');
  end if;

  perform 1
  from private.admin_inventory_authority_v1(
    p_employee_id, p_shop_id, 'inventory.stocktake'
  );

  select s.* into v_stocktake
  from public.stocktakes s
  where s.id = p_stocktake_id and s.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stocktake_not_found');
  end if;
  if v_stocktake.status = 'POSTED' and v_stocktake.post_command_id = p_command_id then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true, 'stocktakeId', v_stocktake.id
    );
  end if;
  if v_stocktake.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'stocktake_not_postable');
  end if;

  if jsonb_array_length(p_lines) <> (
    select count(*) from public.stocktake_lines l where l.stocktake_id = v_stocktake.id
  ) then
    return jsonb_build_object('ok', false, 'code', 'stocktake_line_set_mismatch');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_actual := (v_line ->> 'actualCountMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_stocktake_line');
    end;
    if v_actual is null or v_actual < 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_stocktake_line');
    end if;

    select
      l.snapshot_on_hand_micros,
      l.snapshot_reserved_micros,
      l.unit_cost_minor
      into v_snapshot_on_hand, v_snapshot_reserved, v_unit_cost
    from public.stocktake_lines l
    where l.stocktake_id = v_stocktake.id
      and l.inventory_item_id = v_item_id;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'stocktake_line_set_mismatch');
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('tux-inventory:' || p_shop_id::text || ':' || v_item_id::text, 0)
    );

    select b.on_hand_micros, b.reserved_micros
      into v_current_on_hand, v_current_reserved
    from private.inventory_balance_v1(p_shop_id, v_item_id) b;

    v_delta := v_actual - v_snapshot_on_hand;

    if v_current_on_hand + v_delta - v_current_reserved < 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'stocktake_below_reserved',
        'inventoryItemId', v_item_id
      );
    end if;
  end loop;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_actual := (v_line ->> 'actualCountMicros')::bigint;

    select
      l.snapshot_on_hand_micros,
      l.snapshot_reserved_micros,
      l.unit_cost_minor
      into v_snapshot_on_hand, v_snapshot_reserved, v_unit_cost
    from public.stocktake_lines l
    where l.stocktake_id = v_stocktake.id
      and l.inventory_item_id = v_item_id
    for update;

    v_delta := v_actual - v_snapshot_on_hand;

    update public.stocktake_lines
    set actual_count_micros = v_actual,
        variance_micros = v_delta
    where stocktake_id = v_stocktake.id
      and inventory_item_id = v_item_id;

    if v_delta <> 0 then
      insert into public.inventory_movements(
        id, shop_id, business_day_id, inventory_item_id, movement_type,
        quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
        compensates_movement_id, idempotency_key, admin_employee_id,
        source_kind, command_id, unit_cost_minor, created_at
      ) values (
        gen_random_uuid(), p_shop_id, null, v_item_id, 'STOCKTAKE_ADJUSTMENT',
        v_delta, 0, null, null, null,
        'stocktake:' || p_command_id || ':' || v_item_id::text,
        p_employee_id, 'ADMIN', p_command_id, v_unit_cost, now()
      );
    end if;
  end loop;

  update public.stocktakes
  set status = 'POSTED',
      post_command_id = p_command_id,
      posted_at = now()
  where id = v_stocktake.id;

  return jsonb_build_object(
    'ok', true, 'idempotentReplay', false, 'stocktakeId', v_stocktake.id
  );
end;
$$;

create or replace function public.send_stock_transfer_v1(
  p_employee_id uuid,
  p_source_shop_id uuid,
  p_destination_shop_id uuid,
  p_lines jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_source_business uuid;
  v_destination_business uuid;
  v_role text;
  v_transfer_id uuid;
  v_line jsonb;
  v_resolved_lines jsonb := '[]'::jsonb;
  v_item_id uuid;
  v_destination_item_id uuid;
  v_quantity bigint;
  v_available bigint;
  v_unit_cost numeric(20, 6);
begin
  if p_employee_id is null or p_source_shop_id is null or p_destination_shop_id is null
     or p_source_shop_id = p_destination_shop_id
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_transfer_command');
  end if;

  select t.id into v_transfer_id
  from public.stock_transfers t
  where t.source_shop_id = p_source_shop_id and t.send_command_id = p_command_id;
  if v_transfer_id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotentReplay', true, 'transferId', v_transfer_id
    );
  end if;

  select a.business_id, a.employee_role into v_source_business, v_role
  from private.admin_inventory_authority_v1(
    p_employee_id, p_source_shop_id, 'inventory.transfer'
  ) a;
  select a.business_id into v_destination_business
  from private.admin_inventory_authority_v1(
    p_employee_id, p_destination_shop_id, 'inventory.transfer'
  ) a;

  if v_source_business is distinct from v_destination_business then
    return jsonb_build_object('ok', false, 'code', 'cross_business_transfer_forbidden');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'inventoryItemId'
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_quantity := (v_line ->> 'quantityMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_transfer_line');
    end;
    if v_quantity is null or v_quantity <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_transfer_line');
    end if;
    perform private.assert_inventory_item_shop_v1(p_source_shop_id, v_item_id);
    select destination_item.id
      into v_destination_item_id
    from public.inventory_items destination_item
    join public.inventory_items source_item
      on source_item.id = v_item_id
    where destination_item.shop_id = p_destination_shop_id
      and destination_item.active
      and destination_item.name = source_item.name
      and destination_item.unit_label = source_item.unit_label
    order by destination_item.id
    limit 1;

    if v_destination_item_id is null then
      return jsonb_build_object(
        'ok', false, 'code', 'destination_inventory_item_not_found',
        'inventoryItemId', v_item_id
      );
    end if;

    v_resolved_lines := v_resolved_lines || jsonb_build_array(
      v_line || jsonb_build_object('destinationInventoryItemId', v_destination_item_id)
    );

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_source_shop_id::text || ':' || v_item_id::text,
        0
      )
    );
    select b.available_micros into v_available
    from private.inventory_balance_v1(p_source_shop_id, v_item_id) b;
    if v_available < v_quantity then
      return jsonb_build_object(
        'ok', false, 'code', 'insufficient_stock',
        'inventoryItemId', v_item_id, 'availableMicros', v_available
      );
    end if;
  end loop;

  v_transfer_id := gen_random_uuid();
  insert into public.stock_transfers(
    id, source_shop_id, destination_shop_id, created_by_employee_id,
    status, send_command_id
  ) values (
    v_transfer_id, p_source_shop_id, p_destination_shop_id, p_employee_id,
    'SENT', p_command_id
  );

  for v_line in
    select value from jsonb_array_elements(v_resolved_lines)
    order by value ->> 'inventoryItemId'
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_destination_item_id := (v_line ->> 'destinationInventoryItemId')::uuid;
    v_quantity := (v_line ->> 'quantityMicros')::bigint;
    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_unit_cost
    from public.inventory_cost_state c
    where c.shop_id = p_source_shop_id and c.inventory_item_id = v_item_id;
    v_unit_cost := coalesce(v_unit_cost, 0);

    insert into public.stock_transfer_lines(
      transfer_id, inventory_item_id, destination_inventory_item_id,
      quantity_micros, source_unit_cost_minor
    ) values (
      v_transfer_id, v_item_id, v_destination_item_id,
      v_quantity, v_unit_cost
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_source_shop_id, null, v_item_id, 'TRANSFER_OUT',
      -v_quantity, 0, null, null, null,
      'transfer-out:' || p_command_id || ':' || v_item_id::text,
      p_employee_id, 'ADMIN', p_command_id, v_unit_cost, now()
    );
  end loop;

  return jsonb_build_object(
    'ok', true, 'idempotentReplay', false, 'transferId', v_transfer_id
  );
end;
$$;

create or replace function public.receive_stock_transfer_v1(
  p_employee_id uuid,
  p_transfer_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_source_line public.stock_transfer_lines%rowtype;
  v_destination_item_id uuid;
  v_on_hand bigint;
  v_current_cost numeric(20, 6);
  v_new_cost numeric(20, 6);
begin
  if p_employee_id is null or p_transfer_id is null
     or p_command_id is null or btrim(p_command_id) = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_transfer_receive_command');
  end if;

  select t.* into v_transfer
  from public.stock_transfers t
  where t.id = p_transfer_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'transfer_not_found');
  end if;
  if v_transfer.status = 'RECEIVED' and v_transfer.receive_command_id = p_command_id then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;
  if v_transfer.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'transfer_not_receivable');
  end if;

  perform 1
  from private.admin_inventory_authority_v1(
    p_employee_id, v_transfer.destination_shop_id, 'inventory.transfer'
  );

  for v_source_line in
    select l.*
    from public.stock_transfer_lines l
    where l.transfer_id = p_transfer_id
    order by l.inventory_item_id
  loop
    v_destination_item_id := v_source_line.destination_inventory_item_id;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || v_transfer.destination_shop_id::text || ':'
        || v_destination_item_id::text,
        0
      )
    );

    select b.on_hand_micros into v_on_hand
    from private.inventory_balance_v1(
      v_transfer.destination_shop_id, v_destination_item_id
    ) b;

    select c.weighted_unit_cost_minor into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = v_transfer.destination_shop_id
      and c.inventory_item_id = v_destination_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    if v_on_hand <= 0 then
      v_new_cost := v_source_line.source_unit_cost_minor;
    else
      v_new_cost := (
        (v_on_hand::numeric * v_current_cost)
        + (v_source_line.quantity_micros::numeric * v_source_line.source_unit_cost_minor)
      ) / (v_on_hand + v_source_line.quantity_micros)::numeric;
    end if;

    insert into public.inventory_cost_state(
      shop_id, inventory_item_id, weighted_unit_cost_minor, version
    ) values (
      v_transfer.destination_shop_id, v_destination_item_id, v_new_cost, 1
    )
    on conflict (shop_id, inventory_item_id) do update
    set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
        version = public.inventory_cost_state.version + 1,
        updated_at = now();

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), v_transfer.destination_shop_id, null, v_destination_item_id,
      'TRANSFER_IN', v_source_line.quantity_micros, 0, null, null, null,
      'transfer-in:' || p_command_id || ':' || v_destination_item_id::text,
      p_employee_id, 'ADMIN', p_command_id, v_source_line.source_unit_cost_minor, now()
    );
  end loop;

  update public.stock_transfers
  set status = 'RECEIVED',
      receive_command_id = p_command_id,
      received_at = now(),
      updated_at = now()
  where id = p_transfer_id;

  return jsonb_build_object('ok', true, 'idempotentReplay', false);
end;
$$;

revoke all on function public.reserve_inventory_for_order_v1(uuid, uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.consume_inventory_for_order_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.restore_order_reservation_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.release_inventory_for_order_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.post_inventory_adjustment_v1(uuid, uuid, uuid, bigint, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.post_inventory_waste_v1(uuid, uuid, uuid, bigint, uuid, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.begin_stocktake_v1(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.post_stocktake_v1(uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.send_stock_transfer_v1(uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.receive_stock_transfer_v1(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.reserve_inventory_for_order_v1(uuid, uuid, uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.consume_inventory_for_order_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.restore_order_reservation_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.release_inventory_for_order_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.post_inventory_adjustment_v1(uuid, uuid, uuid, bigint, uuid, text, text, boolean)
  to service_role;
grant execute on function public.post_inventory_waste_v1(uuid, uuid, uuid, bigint, uuid, text, text, boolean)
  to service_role;
grant execute on function public.begin_stocktake_v1(uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.post_stocktake_v1(uuid, uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.send_stock_transfer_v1(uuid, uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.receive_stock_transfer_v1(uuid, uuid, text)
  to service_role;

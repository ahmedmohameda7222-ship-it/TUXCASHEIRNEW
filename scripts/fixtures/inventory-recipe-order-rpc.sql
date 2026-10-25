-- Additional disposable local-only integration fixture for the genuine
-- production consumption RPC and the serial Inventory reservation guard. NEVER apply to Supabase.
-- This creates a shop-scoped recipe-line snapshot; it does not simulate
-- verified Catalog publish events or a live POS/Online Ordering frontend.

create table public.workers (
  id uuid primary key, shop_id uuid not null, active boolean not null default true
);
create table public.business_days (
  id uuid primary key, shop_id uuid not null, status text not null
);
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  business_day_id uuid,
  order_id uuid not null,
  inventory_item_id uuid not null,
  quantity_micros bigint not null,
  status text not null,
  reserve_command_id text not null,
  last_command_id text,
  created_by_worker_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id,order_id,inventory_item_id)
);
create table public.recipe_lines (
  shop_id uuid not null,
  product_id uuid not null,
  inventory_item_id uuid not null,
  quantity_micros bigint not null,
  primary key (shop_id, product_id, inventory_item_id)
);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in (
    'PURCHASE_RECEIPT','PURCHASE_RETURN','TRANSFER_IN','TRANSFER_OUT',
    'TRANSFER_CANCELLED','STOCKTAKE_ADJUSTMENT',
    'ORDER_RESERVATION','ORDER_CONSUMPTION','ORDER_RESERVATION_RELEASE',
    'ORDER_CANCEL_RESTOCK','ORDER_CONSUMPTION_REVERSAL','WASTE'
  ));

insert into public.workers(id,shop_id,active) values
 ('80000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',true);
insert into public.business_days(id,shop_id,status) values
 ('80000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001','OPEN');
insert into public.orders(id,shop_id,status) values
 ('80000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001','DONE'),
 ('80000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000001','DONE'),
 ('80000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000001','DONE');
insert into public.recipe_lines(shop_id,product_id,inventory_item_id,quantity_micros) values
 ('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000001',500000),
 ('20000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000003',250000);

-- Unmodified canonical production CONSUME SQL, READ ONLY captured solely to run on
-- the isolated ephemeral CI database, not deployed or executed in production.
CREATE OR REPLACE FUNCTION public.consume_inventory_for_order_v1(p_shop_id uuid, p_order_id uuid, p_worker_id uuid, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$;

-- Reservation RPC is now created by 20261025175000 migration; do not overwrite its immutable replay guard.


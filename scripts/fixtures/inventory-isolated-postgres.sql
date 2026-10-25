-- Disposable PostgreSQL fixture. Local-loopback-only runner; NEVER use Production.
drop schema if exists public cascade;
drop schema if exists private cascade;
create schema public;
create schema private;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create table public.shops (id uuid primary key, business_id uuid not null, name text not null);
create table public.business_employees (id uuid primary key, business_id uuid not null, active boolean not null default true);
create table public.worker_sessions (id uuid primary key default gen_random_uuid(), shop_id uuid not null, ended_at timestamptz);
create table public.orders (id uuid primary key default gen_random_uuid(), shop_id uuid not null, status text not null);
create table public.inventory_items (
  id uuid primary key, shop_id uuid not null, name text not null,
  unit_label text not null, tracking_mode text not null, active boolean not null,
  unique (shop_id,id)
);
create table public.catalog_master_inventory_items (
  id uuid primary key, business_id uuid not null, canonical_name text not null,
  base_unit_label text not null, tracking_mode text not null
);
create table public.catalog_inventory_item_shop_bindings (
  business_id uuid not null, master_inventory_item_id uuid not null,
  shop_id uuid not null, inventory_item_id uuid not null
);
create table public.inventory_cost_state (
  shop_id uuid not null, inventory_item_id uuid not null,
  weighted_unit_cost_minor numeric(20,6) not null default 0,
  version bigint not null default 1, updated_at timestamptz default now(),
  primary key (shop_id,inventory_item_id)
);
create table public.stock_transfers (
  id uuid primary key, source_shop_id uuid not null, destination_shop_id uuid not null,
  created_by_employee_id uuid not null, status text not null, send_command_id text not null,
  receive_command_id text, sent_at timestamptz not null default now(),
  received_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_shop_id,send_command_id)
);
create table public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(), transfer_id uuid not null,
  inventory_item_id uuid not null, destination_inventory_item_id uuid not null,
  quantity_micros bigint not null, source_unit_cost_minor numeric(20,6) not null,
  created_at timestamptz not null default now(),
  unique (transfer_id,inventory_item_id)
);
create table public.inventory_movements (
  id uuid primary key, shop_id uuid not null, business_day_id uuid,
  inventory_item_id uuid not null, movement_type text not null,
  quantity_delta_micros bigint not null, reserved_delta_micros bigint not null default 0,
  worker_id uuid, order_id uuid, compensates_movement_id uuid, idempotency_key text not null,
  admin_employee_id uuid, source_kind text not null default 'ADMIN',
  command_id text, unit_cost_minor numeric(20,6),
  created_at timestamptz not null default now(),
  unique (shop_id,idempotency_key),
  constraint inventory_movements_movement_type_check
  check (movement_type in ('PURCHASE_RECEIPT','PURCHASE_RETURN','TRANSFER_IN','TRANSFER_OUT','STOCKTAKE_ADJUSTMENT'))
);
create table public.stocktakes (
  id uuid primary key, shop_id uuid not null, created_by_employee_id uuid not null,
  status text not null, command_id text not null, post_command_id text,
  started_at timestamptz not null default now(), posted_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.stocktake_lines (
  id uuid primary key default gen_random_uuid(), stocktake_id uuid not null,
  inventory_item_id uuid not null, snapshot_on_hand_micros bigint not null,
  snapshot_reserved_micros bigint not null default 0,
  posting_expected_on_hand_micros bigint, actual_count_micros bigint,
  variance_micros bigint, unit_cost_minor numeric(20,6) not null default 0
);
create or replace function private.admin_inventory_authority_v1(
  p_employee_id uuid, p_shop_id uuid, p_permission text
) returns table(business_id uuid, employee_role text)
language plpgsql security definer set search_path=pg_catalog,public,private
as $fn$
begin
  return query select sh.business_id, 'OWNER'::text
    from public.shops sh join public.business_employees e
      on e.business_id=sh.business_id
    where sh.id=p_shop_id and e.id=p_employee_id and e.active;
  if not found then raise exception 'authority_scope_forbidden'; end if;
end $fn$;
create or replace function private.assert_inventory_item_shop_v1(
  p_shop_id uuid, p_item_id uuid
) returns void language plpgsql set search_path=pg_catalog,public,private
as $fn$
begin
  if not exists(
    select 1 from public.inventory_items i
    where i.shop_id=p_shop_id and i.id=p_item_id and i.active
  ) then raise exception 'inventory_item_shop_invalid'; end if;
end $fn$;
create or replace function private.inventory_balance_v1(p_shop_id uuid,p_item_id uuid)
returns table(available_micros bigint,on_hand_micros bigint,reserved_micros bigint)
language sql stable set search_path=pg_catalog,public,private
as $fn$
  select
    (coalesce(sum(m.quantity_delta_micros),0)-coalesce(sum(m.reserved_delta_micros),0))::bigint,
    coalesce(sum(m.quantity_delta_micros),0)::bigint,
    coalesce(sum(m.reserved_delta_micros),0)::bigint
  from public.inventory_movements m
  where m.shop_id=p_shop_id and m.inventory_item_id=p_item_id
$fn$;

insert into public.shops(id,business_id,name) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','East'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','West'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Foreign');
insert into public.business_employees(id,business_id,active) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true);
insert into public.catalog_master_inventory_items(id,business_id,canonical_name,base_unit_label,tracking_mode) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Beef','kg','RECIPE_TRACKED'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Other food','kg','RECIPE_TRACKED'),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Unrelated food','kg','RECIPE_TRACKED');
insert into public.inventory_items(id,shop_id,name,unit_label,tracking_mode,active) values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Raw beef','kg','RECIPE_TRACKED',true),
 ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Renamed beef','kg','RECIPE_TRACKED',true),
 ('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Same Name','kg','RECIPE_TRACKED',true),
 ('50000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','Same Name','kg','RECIPE_TRACKED',true);
insert into public.catalog_inventory_item_shop_bindings
 (business_id,master_inventory_item_id,shop_id,inventory_item_id) values
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003'),
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000004');
insert into public.inventory_cost_state(shop_id,inventory_item_id,weighted_unit_cost_minor)
 values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1250);
insert into public.inventory_movements(
 id,shop_id,inventory_item_id,movement_type,quantity_delta_micros,reserved_delta_micros,
 idempotency_key,admin_employee_id,source_kind,created_at
) values
 (gen_random_uuid(),'20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','PURCHASE_RECEIPT',10000000,0,'seed-beef','30000000-0000-4000-8000-000000000001','ADMIN',now()-interval '1 day'),
 (gen_random_uuid(),'20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','PURCHASE_RECEIPT',4000000,0,'seed-name-trap','30000000-0000-4000-8000-000000000001','ADMIN',now()-interval '1 day');

-- Production baseline RECEIVE RPC (read-only captured; local isolated fixture only).
CREATE OR REPLACE FUNCTION public.receive_stock_transfer_v1(p_employee_id uuid, p_transfer_id uuid, p_command_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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

  perform 1
  from private.admin_inventory_authority_v1(
    p_employee_id, v_transfer.destination_shop_id, 'inventory.transfer'
  );

  if v_transfer.status = 'RECEIVED' and v_transfer.receive_command_id = p_command_id then
    return jsonb_build_object('ok', true, 'idempotentReplay', true);
  end if;
  if v_transfer.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'transfer_not_receivable');
  end if;

  for v_destination_item_id in
    select l.destination_inventory_item_id
    from public.stock_transfer_lines l
    where l.transfer_id = p_transfer_id
    order by l.destination_inventory_item_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || v_transfer.destination_shop_id::text || ':'
        || v_destination_item_id::text,
        0
      )
    );
  end loop;

  for v_source_line in
    select l.*
    from public.stock_transfer_lines l
    where l.transfer_id = p_transfer_id
    order by l.destination_inventory_item_id, l.inventory_item_id
  loop
    v_destination_item_id := v_source_line.destination_inventory_item_id;

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
$function$;

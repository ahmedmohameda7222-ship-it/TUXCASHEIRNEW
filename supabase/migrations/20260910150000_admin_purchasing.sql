-- TUX Admin Plan 4 Task 5: suppliers, purchase orders, receiving, and purchase returns.

create unique index if not exists inventory_unit_conversions_item_purchase_label_ci_uq
  on public.inventory_unit_conversions(
    inventory_item_id,
    lower(btrim(purchase_unit_label))
  )
  where active;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  contact_name text,
  phone text,
  email text,
  active boolean not null default true,
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create unique index suppliers_business_name_uq
  on public.suppliers(business_id, lower(name))
  where active;

create table public.supplier_inventory_items (
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  supplier_sku text,
  purchase_unit_label text not null check (btrim(purchase_unit_label) <> ''),
  base_micros_per_purchase_unit bigint not null check (base_micros_per_purchase_unit > 0),
  last_unit_cost_minor numeric(20, 6) check (last_unit_cost_minor is null or last_unit_cost_minor >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, inventory_item_id)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  reference text,
  expected_delivery_date date,
  version bigint not null default 1 check (version > 0),
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  ordered_at timestamptz,
  cancelled_at timestamptz,
  create_command_id text not null check (btrim(create_command_id) <> ''),
  order_command_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  unique (shop_id, create_command_id),
  check (
    (status = 'DRAFT' and ordered_at is null and cancelled_at is null)
    or (status in ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED') and ordered_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_at is not null)
  )
);

create index purchase_orders_shop_status_idx
  on public.purchase_orders(shop_id, status, expected_delivery_date, id);
create index purchase_orders_supplier_idx
  on public.purchase_orders(supplier_id, created_at desc, id);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  purchase_unit_label text not null check (btrim(purchase_unit_label) <> ''),
  base_micros_per_purchase_unit bigint not null check (base_micros_per_purchase_unit > 0),
  ordered_purchase_units_micros bigint not null check (ordered_purchase_units_micros > 0),
  received_purchase_units_micros bigint not null default 0 check (received_purchase_units_micros >= 0),
  returned_purchase_units_micros bigint not null default 0 check (returned_purchase_units_micros >= 0),
  ordered_base_micros bigint not null check (ordered_base_micros > 0),
  received_base_micros bigint not null default 0 check (received_base_micros >= 0),
  returned_base_micros bigint not null default 0 check (returned_base_micros >= 0),
  expected_purchase_unit_cost_minor numeric(20, 6) not null check (expected_purchase_unit_cost_minor >= 0),
  expected_unit_cost_minor numeric(20, 6) not null check (expected_unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_order_id, inventory_item_id),
  check (received_purchase_units_micros <= ordered_purchase_units_micros),
  check (returned_purchase_units_micros <= received_purchase_units_micros),
  check (received_base_micros <= ordered_base_micros),
  check (returned_base_micros <= received_base_micros)
);

create index purchase_order_lines_item_idx
  on public.purchase_order_lines(inventory_item_id, purchase_order_id);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_reference text,
  command_id text not null check (btrim(command_id) <> ''),
  received_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  received_at timestamptz not null default now(),
  unique (shop_id, command_id)
);

create table public.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_receipt_id uuid not null references public.purchase_receipts(id) on delete restrict,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  received_purchase_units_micros bigint not null check (received_purchase_units_micros > 0),
  received_base_micros bigint not null check (received_base_micros > 0),
  purchase_unit_cost_minor numeric(20, 6) not null check (purchase_unit_cost_minor >= 0),
  unit_cost_minor numeric(20, 6) not null check (unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_receipt_id, purchase_order_line_id)
);

create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_reference text,
  command_id text not null check (btrim(command_id) <> ''),
  purchase_price_variance_minor numeric(20, 6) not null default 0,
  returned_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  returned_at timestamptz not null default now(),
  unique (shop_id, command_id)
);

create table public.purchase_return_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_return_id uuid not null references public.purchase_returns(id) on delete restrict,
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  purchase_receipt_line_id uuid not null references public.purchase_receipt_lines(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  returned_purchase_units_micros bigint not null check (returned_purchase_units_micros > 0),
  returned_base_micros bigint not null check (returned_base_micros > 0),
  purchase_unit_cost_minor numeric(20, 6) not null check (purchase_unit_cost_minor >= 0),
  unit_cost_minor numeric(20, 6) not null check (unit_cost_minor >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_return_id, purchase_receipt_line_id)
);

create table public.supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  purchase_receipt_id uuid references public.purchase_receipts(id) on delete restrict,
  purchase_return_id uuid references public.purchase_returns(id) on delete restrict,
  source_kind text not null check (source_kind in ('RECEIPT', 'RETURN')),
  purchase_unit_label text not null check (btrim(purchase_unit_label) <> ''),
  base_micros_per_purchase_unit bigint not null check (base_micros_per_purchase_unit > 0),
  purchase_unit_cost_minor numeric(20, 6) not null check (purchase_unit_cost_minor >= 0),
  unit_cost_minor numeric(20, 6) not null check (unit_cost_minor >= 0),
  recorded_at timestamptz not null default now(),
  check (
    (source_kind = 'RECEIPT' and purchase_receipt_id is not null and purchase_return_id is null)
    or
    (source_kind = 'RETURN' and purchase_return_id is not null and purchase_receipt_id is null)
  )
);

create index supplier_price_history_lookup_idx
  on public.supplier_price_history(supplier_id, inventory_item_id, recorded_at desc, id);

alter table public.suppliers enable row level security;
alter table public.supplier_inventory_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_lines enable row level security;
alter table public.purchase_returns enable row level security;
alter table public.purchase_return_lines enable row level security;
alter table public.supplier_price_history enable row level security;

revoke all on public.suppliers from public, anon, authenticated;
revoke all on public.supplier_inventory_items from public, anon, authenticated;
revoke all on public.purchase_orders from public, anon, authenticated;
revoke all on public.purchase_order_lines from public, anon, authenticated;
revoke all on public.purchase_receipts from public, anon, authenticated;
revoke all on public.purchase_receipt_lines from public, anon, authenticated;
revoke all on public.purchase_returns from public, anon, authenticated;
revoke all on public.purchase_return_lines from public, anon, authenticated;
revoke all on public.supplier_price_history from public, anon, authenticated;

grant select, insert, update, delete on public.suppliers to service_role;
grant select, insert, update, delete on public.supplier_inventory_items to service_role;
grant select, insert, update, delete on public.purchase_orders to service_role;
grant select, insert, update, delete on public.purchase_order_lines to service_role;
grant select, insert, update, delete on public.purchase_receipts to service_role;
grant select, insert, update, delete on public.purchase_receipt_lines to service_role;
grant select, insert, update, delete on public.purchase_returns to service_role;
grant select, insert, update, delete on public.purchase_return_lines to service_role;
grant select, insert, update, delete on public.supplier_price_history to service_role;

alter table public.inventory_replenishment_settings
  add constraint inventory_replenishment_settings_preferred_supplier_fk
  foreign key (preferred_supplier_id) references public.suppliers(id) on delete restrict
  not valid;

alter table public.inventory_replenishment_settings
  validate constraint inventory_replenishment_settings_preferred_supplier_fk;

create or replace function private.admin_purchasing_authority_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_authorized boolean;
  v_business_id uuid;
begin
  select a.authorized, a.business_id
    into v_authorized, v_business_id
  from public.resolve_admin_authorization_v1(
    p_employee_id,
    p_shop_id,
    p_permission
  ) a
  limit 1;

  if not coalesce(v_authorized, false) then
    raise exception 'TUX_ADMIN_PURCHASING_PERMISSION_REQUIRED';
  end if;
  return v_business_id;
end;
$$;

revoke all on function private.admin_purchasing_authority_v1(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.create_supplier_v1(
  p_employee_id uuid,
  p_business_id uuid,
  p_shop_id uuid,
  p_name text,
  p_contact_name text,
  p_phone text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_supplier_id uuid;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );
  if v_business_id is distinct from p_business_id
     or nullif(btrim(coalesce(p_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_supplier_command');
  end if;

  insert into public.suppliers(
    business_id, name, contact_name, phone, email, created_by_employee_id
  ) values (
    v_business_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_contact_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    p_employee_id
  )
  returning id into v_supplier_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_SUPPLIER_CREATED', 'SUPPLIER', v_supplier_id::text,
    null,
    jsonb_build_object('name', btrim(p_name)),
    null, null, null, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'supplierId', v_supplier_id);
end;
$$;

create or replace function public.create_purchase_order_v1(
  p_employee_id uuid,
  p_business_id uuid,
  p_shop_id uuid,
  p_supplier_id uuid,
  p_reference text,
  p_expected_delivery_date date,
  p_lines jsonb,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_purchase_order_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_ordered_purchase bigint;
  v_ordered_base_numeric numeric;
  v_ordered_base bigint;
  v_purchase_cost numeric(20, 6);
  v_base_cost numeric(20, 6);
  v_purchase_unit text;
  v_base_unit text;
  v_conversion bigint;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );
  if v_business_id is distinct from p_business_id
     or p_supplier_id is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or nullif(btrim(coalesce(p_command_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_purchase_order_command');
  end if;

  select po.id into v_purchase_order_id
  from public.purchase_orders po
  where po.shop_id = p_shop_id and po.create_command_id = p_command_id;
  if v_purchase_order_id is not null then
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_purchase_order_id,
      'status', 'DRAFT', 'version', 1, 'idempotentReplay', true
    );
  end if;

  if not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier_id and s.business_id = v_business_id and s.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'supplier_not_found');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_item_id := (v_line ->> 'inventoryItemId')::uuid;
      v_ordered_purchase := (v_line ->> 'orderedPurchaseUnitsMicros')::bigint;
      v_purchase_cost := (v_line ->> 'expectedPurchaseUnitCostMinor')::numeric;
      v_purchase_unit := nullif(btrim(v_line ->> 'purchaseUnitLabel'), '');
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_purchase_order_line');
    end;
    if v_ordered_purchase <= 0 or v_purchase_cost < 0 or v_purchase_unit is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_purchase_order_line');
    end if;

    select i.unit_label into v_base_unit
    from public.inventory_items i
    where i.id = v_item_id and i.shop_id = p_shop_id and i.active;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'inventory_item_not_found');
    end if;

    if lower(v_purchase_unit) = lower(btrim(v_base_unit)) then
      v_conversion := 1000000;
    else
      select u.base_micros_per_purchase_unit into v_conversion
      from public.inventory_unit_conversions u
      where u.shop_id = p_shop_id
        and u.inventory_item_id = v_item_id
        and lower(btrim(u.purchase_unit_label)) = lower(v_purchase_unit)
        and u.active;
    end if;
    if v_conversion is null then
      return jsonb_build_object(
        'ok', false, 'code', 'purchase_unit_conversion_not_found',
        'inventoryItemId', v_item_id
      );
    end if;

    v_ordered_base_numeric :=
      (v_ordered_purchase::numeric * v_conversion::numeric) / 1000000::numeric;
    if v_ordered_base_numeric <= 0 or v_ordered_base_numeric <> trunc(v_ordered_base_numeric) then
      return jsonb_build_object('ok', false, 'code', 'purchase_unit_conversion_inexact');
    end if;
  end loop;

  insert into public.purchase_orders(
    business_id, shop_id, supplier_id, reference, expected_delivery_date,
    created_by_employee_id, create_command_id
  ) values (
    v_business_id, p_shop_id, p_supplier_id,
    nullif(btrim(coalesce(p_reference, '')), ''),
    p_expected_delivery_date, p_employee_id, p_command_id
  )
  returning id into v_purchase_order_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line ->> 'inventoryItemId')::uuid;
    v_ordered_purchase := (v_line ->> 'orderedPurchaseUnitsMicros')::bigint;
    v_purchase_cost := (v_line ->> 'expectedPurchaseUnitCostMinor')::numeric;
    v_purchase_unit := btrim(v_line ->> 'purchaseUnitLabel');

    select i.unit_label into v_base_unit
    from public.inventory_items i where i.id = v_item_id and i.shop_id = p_shop_id;
    if lower(v_purchase_unit) = lower(btrim(v_base_unit)) then
      v_conversion := 1000000;
    else
      select u.base_micros_per_purchase_unit into v_conversion
      from public.inventory_unit_conversions u
      where u.shop_id = p_shop_id
        and u.inventory_item_id = v_item_id
        and lower(btrim(u.purchase_unit_label)) = lower(v_purchase_unit)
        and u.active;
    end if;

    v_ordered_base :=
      ((v_ordered_purchase::numeric * v_conversion::numeric) / 1000000::numeric)::bigint;
    v_base_cost := (v_purchase_cost * 1000000::numeric) / v_conversion::numeric;

    insert into public.purchase_order_lines(
      purchase_order_id, inventory_item_id, purchase_unit_label,
      base_micros_per_purchase_unit,
      ordered_purchase_units_micros, ordered_base_micros,
      expected_purchase_unit_cost_minor, expected_unit_cost_minor
    ) values (
      v_purchase_order_id, v_item_id, v_purchase_unit,
      v_conversion,
      v_ordered_purchase, v_ordered_base,
      v_purchase_cost, v_base_cost
    );
  end loop;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_CREATED', 'PURCHASE_ORDER', v_purchase_order_id::text,
    null,
    jsonb_build_object(
      'supplierId', p_supplier_id,
      'reference', nullif(btrim(coalesce(p_reference, '')), ''),
      'expectedDeliveryDate', p_expected_delivery_date,
      'lineCount', jsonb_array_length(p_lines)
    ),
    null, null, null, '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_purchase_order_id,
    'status', 'DRAFT', 'version', 1, 'idempotentReplay', false
  );
end;
$$;

create or replace function public.update_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_expected_version bigint,
  p_reference text,
  p_expected_delivery_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;
  if v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;
  if v_order.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_version', 'currentVersion', v_order.version
    );
  end if;
  if v_order.status not in ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_editable');
  end if;

  update public.purchase_orders
  set reference = nullif(btrim(coalesce(p_reference, '')), ''),
      expected_delivery_date = p_expected_delivery_date,
      version = version + 1,
      updated_at = now()
  where id = p_purchase_order_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_UPDATED', 'PURCHASE_ORDER', p_purchase_order_id::text,
    jsonb_build_object(
      'reference', v_order.reference,
      'expectedDeliveryDate', v_order.expected_delivery_date,
      'version', v_order.version
    ),
    jsonb_build_object(
      'reference', nullif(btrim(coalesce(p_reference, '')), ''),
      'expectedDeliveryDate', p_expected_delivery_date,
      'version', v_order.version + 1
    ),
    null, null, null, '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', p_purchase_order_id,
    'status', v_order.status, 'version', v_order.version + 1
  );
end;
$$;

create or replace function public.order_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_expected_version bigint,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.manage'
  );

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found or v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;
  if v_order.status = 'ORDERED' and v_order.order_command_id = p_command_id then
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'status', v_order.status, 'version', v_order.version, 'idempotentReplay', true
    );
  end if;
  if v_order.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_version', 'currentVersion', v_order.version
    );
  end if;
  if v_order.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_orderable');
  end if;

  update public.purchase_orders
  set status = 'ORDERED',
      ordered_at = now(),
      order_command_id = p_command_id,
      version = version + 1,
      updated_at = now()
  where id = v_order.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_ORDERED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', 'DRAFT', 'version', v_order.version),
    jsonb_build_object('status', 'ORDERED', 'version', v_order.version + 1),
    null, null, null, '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_order.id,
    'status', 'ORDERED', 'version', v_order.version + 1, 'idempotentReplay', false
  );
end;
$$;

create or replace function public.receive_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_command_id text,
  p_supplier_reference text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
  v_existing_receipt uuid;
  v_existing_receipt_purchase_order_id uuid;
  v_receipt_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_received_purchase bigint;
  v_received_base_numeric numeric;
  v_received bigint;
  v_purchase_cost numeric(20, 6);
  v_unit_cost numeric(20, 6);
  v_po_line public.purchase_order_lines%rowtype;
  v_on_hand bigint;
  v_current_cost numeric(20, 6);
  v_new_cost numeric(20, 6);
  v_complete boolean;
  v_new_status text;
  v_new_version bigint;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.receive'
  );
  if nullif(btrim(coalesce(p_command_id, '')), '') is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_receive_command');
  end if;

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found or v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;

  select r.id, r.purchase_order_id
    into v_existing_receipt, v_existing_receipt_purchase_order_id
  from public.purchase_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id;
  if v_existing_receipt is not null then
    if v_existing_receipt_purchase_order_id is distinct from v_order.id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'receiptId', v_existing_receipt, 'status', v_order.status,
      'version', v_order.version, 'idempotentReplay', true
    );
  end if;
  if v_order.status not in ('ORDERED', 'PARTIALLY_RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_receivable');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    begin
      v_line_id := (v_line ->> 'lineId')::uuid;
      v_received_purchase := (v_line ->> 'receivedPurchaseUnitsMicros')::bigint;
      v_purchase_cost := (v_line ->> 'purchaseUnitCostMinor')::numeric;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_receive_line');
    end;
    if v_received_purchase <= 0 or v_purchase_cost < 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_receive_line');
    end if;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'purchase_order_line_not_found');
    end if;

    v_received_base_numeric :=
      (v_received_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
      / 1000000::numeric;
    if v_received_base_numeric <= 0
       or v_received_base_numeric <> trunc(v_received_base_numeric) then
      return jsonb_build_object('ok', false, 'code', 'purchase_unit_conversion_inexact');
    end if;
    v_received := v_received_base_numeric::bigint;

    if v_received_purchase >
       v_po_line.ordered_purchase_units_micros - v_po_line.received_purchase_units_micros
       or v_received > v_po_line.ordered_base_micros - v_po_line.received_base_micros then
      return jsonb_build_object(
        'ok', false, 'code', 'receive_exceeds_remaining',
        'lineId', v_po_line.id,
        'remainingBaseMicros', v_po_line.ordered_base_micros - v_po_line.received_base_micros
      );
    end if;
  end loop;

  v_receipt_id := gen_random_uuid();
  insert into public.purchase_receipts(
    id, purchase_order_id, shop_id, supplier_id, supplier_reference,
    command_id, received_by_employee_id
  ) values (
    v_receipt_id, v_order.id, p_shop_id, v_order.supplier_id,
    nullif(btrim(coalesce(p_supplier_reference, '')), ''),
    p_command_id, p_employee_id
  );

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    v_line_id := (v_line ->> 'lineId')::uuid;
    v_received_purchase := (v_line ->> 'receivedPurchaseUnitsMicros')::bigint;
    v_purchase_cost := (v_line ->> 'purchaseUnitCostMinor')::numeric;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;

    v_received :=
      ((v_received_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
       / 1000000::numeric)::bigint;
    v_unit_cost :=
      (v_purchase_cost * 1000000::numeric) / v_po_line.base_micros_per_purchase_unit::numeric;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_po_line.inventory_item_id::text, 0
      )
    );

    select b.on_hand_micros into v_on_hand
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;

    select c.weighted_unit_cost_minor into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    if v_on_hand <= 0 then
      v_new_cost := v_unit_cost;
    else
      v_new_cost := (
        (v_on_hand::numeric * v_current_cost)
        + (v_received::numeric * v_unit_cost)
      ) / (v_on_hand + v_received)::numeric;
    end if;

    insert into public.purchase_receipt_lines(
      purchase_receipt_id, purchase_order_line_id, inventory_item_id,
      received_purchase_units_micros, received_base_micros,
      purchase_unit_cost_minor, unit_cost_minor
    ) values (
      v_receipt_id, v_po_line.id, v_po_line.inventory_item_id,
      v_received_purchase, v_received, v_purchase_cost, v_unit_cost
    );

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_shop_id, null, v_po_line.inventory_item_id, 'PURCHASE_RECEIPT',
      v_received, 0, null, null, null,
      'purchase-receipt:' || p_command_id || ':' || v_po_line.id::text,
      p_employee_id, 'ADMIN', p_command_id, v_unit_cost, now()
    );

    insert into public.inventory_cost_state(
      shop_id, inventory_item_id, weighted_unit_cost_minor, version
    ) values (
      p_shop_id, v_po_line.inventory_item_id, v_new_cost, 1
    )
    on conflict (shop_id, inventory_item_id) do update
    set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
        version = public.inventory_cost_state.version + 1,
        updated_at = now();

    update public.purchase_order_lines
    set received_purchase_units_micros =
          received_purchase_units_micros + v_received_purchase,
        received_base_micros = received_base_micros + v_received,
        updated_at = now()
    where id = v_po_line.id;

    insert into public.supplier_inventory_items(
      supplier_id, inventory_item_id, purchase_unit_label,
      base_micros_per_purchase_unit, last_unit_cost_minor
    ) values (
      v_order.supplier_id, v_po_line.inventory_item_id, v_po_line.purchase_unit_label,
      v_po_line.base_micros_per_purchase_unit, v_purchase_cost
    )
    on conflict (supplier_id, inventory_item_id) do update
    set purchase_unit_label = excluded.purchase_unit_label,
        base_micros_per_purchase_unit = excluded.base_micros_per_purchase_unit,
        last_unit_cost_minor = excluded.last_unit_cost_minor,
        active = true,
        updated_at = now();

    insert into public.supplier_price_history(
      supplier_id, inventory_item_id, purchase_order_id, purchase_receipt_id,
      source_kind, purchase_unit_label, base_micros_per_purchase_unit,
      purchase_unit_cost_minor, unit_cost_minor
    ) values (
      v_order.supplier_id, v_po_line.inventory_item_id, v_order.id, v_receipt_id,
      'RECEIPT', v_po_line.purchase_unit_label, v_po_line.base_micros_per_purchase_unit,
      v_purchase_cost, v_unit_cost
    );
  end loop;

  select not exists (
    select 1
    from public.purchase_order_lines pol
    where pol.purchase_order_id = v_order.id
      and pol.received_base_micros < pol.ordered_base_micros
  ) into v_complete;

  v_new_status := case when v_complete then 'RECEIVED' else 'PARTIALLY_RECEIVED' end;
  v_new_version := v_order.version + 1;

  update public.purchase_orders
  set status = v_new_status,
      version = v_new_version,
      updated_at = now()
  where id = v_order.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_RECEIVED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object(
      'status', v_new_status, 'version', v_new_version,
      'receiptId', v_receipt_id,
      'supplierReference', nullif(btrim(coalesce(p_supplier_reference, '')), '')
    ),
    null, null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_order.id, 'receiptId', v_receipt_id,
    'status', v_new_status, 'version', v_new_version, 'idempotentReplay', false
  );
end;
$$;

create or replace function public.return_purchase_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_purchase_order_id uuid,
  p_command_id text,
  p_supplier_reference text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_order public.purchase_orders%rowtype;
  v_existing_return uuid;
  v_existing_return_purchase_order_id uuid;
  v_return_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_returned_purchase bigint;
  v_returned_base_numeric numeric;
  v_returned bigint;
  v_po_line public.purchase_order_lines%rowtype;
  v_available bigint;
  v_on_hand bigint;
  v_current_cost numeric(20, 6);
  v_current_value numeric;
  v_return_value numeric;
  v_inventory_value_removed numeric;
  v_line_purchase_price_variance numeric(20, 6);
  v_total_purchase_price_variance numeric(20, 6) := 0;
  v_weighted_return_cost numeric(20, 6);
  v_new_on_hand bigint;
  v_new_value numeric;
  v_new_cost numeric(20, 6);
  v_receipt_line record;
  v_receipt_available bigint;
  v_alloc bigint;
  v_alloc_purchase numeric;
  v_remaining bigint;
  v_new_version bigint;
begin
  v_business_id := private.admin_purchasing_authority_v1(
    p_employee_id, p_shop_id, 'purchasing.receive'
  );
  if nullif(btrim(coalesce(p_command_id, '')), '') is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_return_command');
  end if;

  select po.* into v_order
  from public.purchase_orders po
  where po.id = p_purchase_order_id and po.shop_id = p_shop_id
  for update;

  if not found or v_order.business_id is distinct from v_business_id then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_found');
  end if;

  select r.id, r.purchase_order_id
    into v_existing_return, v_existing_return_purchase_order_id
  from public.purchase_returns r
  where r.shop_id = p_shop_id and r.command_id = p_command_id;
  if v_existing_return is not null then
    if v_existing_return_purchase_order_id is distinct from v_order.id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'purchaseOrderId', v_order.id,
      'returnId', v_existing_return, 'status', v_order.status,
      'version', v_order.version, 'idempotentReplay', true
    );
  end if;
  if v_order.status not in ('PARTIALLY_RECEIVED', 'RECEIVED') then
    return jsonb_build_object('ok', false, 'code', 'purchase_order_not_returnable');
  end if;

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    begin
      v_line_id := (v_line ->> 'lineId')::uuid;
      v_returned_purchase := (v_line ->> 'returnedPurchaseUnitsMicros')::bigint;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_line');
    end;
    if v_returned_purchase <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_line');
    end if;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'purchase_order_line_not_found');
    end if;

    v_returned_base_numeric :=
      (v_returned_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
      / 1000000::numeric;
    if v_returned_base_numeric <= 0
       or v_returned_base_numeric <> trunc(v_returned_base_numeric) then
      return jsonb_build_object('ok', false, 'code', 'purchase_unit_conversion_inexact');
    end if;
    v_returned := v_returned_base_numeric::bigint;

    if v_returned_purchase >
       v_po_line.received_purchase_units_micros - v_po_line.returned_purchase_units_micros
       or v_returned > v_po_line.received_base_micros - v_po_line.returned_base_micros then
      return jsonb_build_object(
        'ok', false, 'code', 'return_exceeds_received',
        'lineId', v_po_line.id,
        'returnableBaseMicros', v_po_line.received_base_micros - v_po_line.returned_base_micros
      );
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'tux-inventory:' || p_shop_id::text || ':' || v_po_line.inventory_item_id::text, 0
      )
    );

    select b.on_hand_micros, b.available_micros
      into v_on_hand, v_available
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;
    if v_available < v_returned then
      return jsonb_build_object(
        'ok', false, 'code', 'insufficient_stock',
        'lineId', v_po_line.id, 'remainingBaseMicros', v_available
      );
    end if;

    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    select coalesce(sum(
      greatest(
        0::numeric,
        least(
          x.receipt_available::numeric,
          v_returned::numeric - x.before_available
        )
      ) * x.unit_cost_minor
    ), 0)
    into v_return_value
    from (
      select
        q.*,
        coalesce(
          sum(q.receipt_available) over (
            order by q.received_at desc, q.receipt_line_id desc
            rows between unbounded preceding and 1 preceding
          ),
          0
        )::numeric as before_available
      from (
        select
          rl.id as receipt_line_id,
          r.received_at,
          rl.unit_cost_minor,
          greatest(
            0,
            rl.received_base_micros
            - coalesce((
              select sum(prl.returned_base_micros)
              from public.purchase_return_lines prl
              where prl.purchase_receipt_line_id = rl.id
            ), 0)
          )::bigint as receipt_available
        from public.purchase_receipt_lines rl
        join public.purchase_receipts r on r.id = rl.purchase_receipt_id
        where rl.purchase_order_line_id = v_po_line.id
      ) q
    ) x;

  end loop;

  v_return_id := gen_random_uuid();
  insert into public.purchase_returns(
    id, purchase_order_id, shop_id, supplier_id, supplier_reference,
    command_id, returned_by_employee_id
  ) values (
    v_return_id, v_order.id, p_shop_id, v_order.supplier_id,
    nullif(btrim(coalesce(p_supplier_reference, '')), ''),
    p_command_id, p_employee_id
  );

  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value ->> 'lineId'
  loop
    v_line_id := (v_line ->> 'lineId')::uuid;
    v_returned_purchase := (v_line ->> 'returnedPurchaseUnitsMicros')::bigint;

    select pol.* into v_po_line
    from public.purchase_order_lines pol
    where pol.id = v_line_id and pol.purchase_order_id = v_order.id
    for update;

    v_returned :=
      ((v_returned_purchase::numeric * v_po_line.base_micros_per_purchase_unit::numeric)
       / 1000000::numeric)::bigint;

    select b.on_hand_micros into v_on_hand
    from private.inventory_balance_v1(p_shop_id, v_po_line.inventory_item_id) b;
    select coalesce(c.weighted_unit_cost_minor, 0)
      into v_current_cost
    from public.inventory_cost_state c
    where c.shop_id = p_shop_id
      and c.inventory_item_id = v_po_line.inventory_item_id
    for update;
    v_current_cost := coalesce(v_current_cost, 0);

    v_remaining := v_returned;
    v_return_value := 0;

    for v_receipt_line in
      select
        rl.id,
        rl.received_base_micros,
        rl.purchase_unit_cost_minor,
        rl.unit_cost_minor,
        r.received_at,
        greatest(
          0,
          rl.received_base_micros
          - coalesce((
            select sum(prl.returned_base_micros)
            from public.purchase_return_lines prl
            where prl.purchase_receipt_line_id = rl.id
          ), 0)
        )::bigint as available_base
      from public.purchase_receipt_lines rl
      join public.purchase_receipts r on r.id = rl.purchase_receipt_id
      where rl.purchase_order_line_id = v_po_line.id
      order by r.received_at desc, rl.id desc
    loop
      exit when v_remaining <= 0;
      v_receipt_available := v_receipt_line.available_base;
      if v_receipt_available <= 0 then
        continue;
      end if;
      v_alloc := least(v_remaining, v_receipt_available);
      v_alloc_purchase :=
        (v_alloc::numeric * 1000000::numeric)
        / v_po_line.base_micros_per_purchase_unit::numeric;

      insert into public.purchase_return_lines(
        purchase_return_id, purchase_order_line_id, purchase_receipt_line_id,
        inventory_item_id, returned_purchase_units_micros, returned_base_micros,
        purchase_unit_cost_minor, unit_cost_minor
      ) values (
        v_return_id, v_po_line.id, v_receipt_line.id,
        v_po_line.inventory_item_id, round(v_alloc_purchase)::bigint, v_alloc,
        v_receipt_line.purchase_unit_cost_minor, v_receipt_line.unit_cost_minor
      );

      insert into public.supplier_price_history(
        supplier_id, inventory_item_id, purchase_order_id, purchase_return_id,
        source_kind, purchase_unit_label, base_micros_per_purchase_unit,
        purchase_unit_cost_minor, unit_cost_minor
      ) values (
        v_order.supplier_id, v_po_line.inventory_item_id, v_order.id, v_return_id,
        'RETURN', v_po_line.purchase_unit_label, v_po_line.base_micros_per_purchase_unit,
        v_receipt_line.purchase_unit_cost_minor, v_receipt_line.unit_cost_minor
      );

      v_return_value := v_return_value + v_alloc::numeric * v_receipt_line.unit_cost_minor;
      v_remaining := v_remaining - v_alloc;
    end loop;

    if v_remaining <> 0 then
      raise exception 'TUX_PURCHASE_RETURN_ALLOCATION_INVARIANT';
    end if;

    v_current_value := v_on_hand::numeric * v_current_cost;
    v_new_on_hand := v_on_hand - v_returned;
    if v_new_on_hand <= 0 then
      v_inventory_value_removed := v_current_value;
      v_line_purchase_price_variance :=
        (v_return_value - v_inventory_value_removed) / 1000000::numeric;
    elsif v_return_value > v_current_value then
      v_inventory_value_removed := v_returned::numeric * v_current_cost;
      v_line_purchase_price_variance :=
        (v_return_value - v_inventory_value_removed) / 1000000::numeric;
    else
      v_inventory_value_removed := v_return_value;
      v_line_purchase_price_variance := 0;
    end if;
    v_total_purchase_price_variance :=
      v_total_purchase_price_variance + v_line_purchase_price_variance;
    v_weighted_return_cost := v_inventory_value_removed / v_returned::numeric;
    v_new_value := v_current_value - v_inventory_value_removed;
    v_new_cost := case
      when v_new_on_hand <= 0 then 0
      else v_new_value / v_new_on_hand::numeric
    end;

    insert into public.inventory_movements(
      id, shop_id, business_day_id, inventory_item_id, movement_type,
      quantity_delta_micros, reserved_delta_micros, worker_id, order_id,
      compensates_movement_id, idempotency_key, admin_employee_id,
      source_kind, command_id, unit_cost_minor, created_at
    ) values (
      gen_random_uuid(), p_shop_id, null, v_po_line.inventory_item_id, 'PURCHASE_RETURN',
      -v_returned, 0, null, null, null,
      'purchase-return:' || p_command_id || ':' || v_po_line.id::text,
      p_employee_id, 'ADMIN', p_command_id, v_weighted_return_cost, now()
    );

    insert into public.inventory_cost_state(
      shop_id, inventory_item_id, weighted_unit_cost_minor, version
    ) values (
      p_shop_id, v_po_line.inventory_item_id, v_new_cost, 1
    )
    on conflict (shop_id, inventory_item_id) do update
    set weighted_unit_cost_minor = excluded.weighted_unit_cost_minor,
        version = public.inventory_cost_state.version + 1,
        updated_at = now();

    update public.purchase_order_lines
    set returned_purchase_units_micros =
          returned_purchase_units_micros + v_returned_purchase,
        returned_base_micros = returned_base_micros + v_returned,
        updated_at = now()
    where id = v_po_line.id;
  end loop;

  update public.purchase_returns
  set purchase_price_variance_minor = v_total_purchase_price_variance
  where id = v_return_id;

  v_new_version := v_order.version + 1;
  update public.purchase_orders
  set version = v_new_version, updated_at = now()
  where id = v_order.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'PURCHASING_PO_RETURNED', 'PURCHASE_ORDER', v_order.id::text,
    jsonb_build_object('status', v_order.status, 'version', v_order.version),
    jsonb_build_object(
      'status', v_order.status, 'version', v_new_version,
      'returnId', v_return_id,
      'supplierReference', nullif(btrim(coalesce(p_supplier_reference, '')), ''),
      'purchasePriceVarianceMinor', v_total_purchase_price_variance
    ),
    null, null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  return jsonb_build_object(
    'ok', true, 'purchaseOrderId', v_order.id, 'returnId', v_return_id,
    'status', v_order.status, 'version', v_new_version,
    'purchasePriceVarianceMinor', v_total_purchase_price_variance,
    'idempotentReplay', false
  );
end;
$$;

revoke all on function public.create_supplier_v1(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_purchase_order_v1(uuid, uuid, uuid, uuid, text, date, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.update_purchase_order_v1(uuid, uuid, uuid, bigint, text, date)
  from public, anon, authenticated;
revoke all on function public.order_purchase_order_v1(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.receive_purchase_order_v1(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.return_purchase_order_v1(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_supplier_v1(uuid, uuid, uuid, text, text, text, text)
  to service_role;
grant execute on function public.create_purchase_order_v1(uuid, uuid, uuid, uuid, text, date, jsonb, text)
  to service_role;
grant execute on function public.update_purchase_order_v1(uuid, uuid, uuid, bigint, text, date)
  to service_role;
grant execute on function public.order_purchase_order_v1(uuid, uuid, uuid, bigint, text)
  to service_role;
grant execute on function public.receive_purchase_order_v1(uuid, uuid, uuid, text, text, jsonb)
  to service_role;
grant execute on function public.return_purchase_order_v1(uuid, uuid, uuid, text, text, jsonb)
  to service_role;

-- TUX Admin Plan 4 Task 4: inventory intelligence and replenishment policy.
-- Supplier authority is introduced by Task 5, so preferred_supplier_id is intentionally
-- a nullable identifier without a foreign key in this migration.

create table public.inventory_replenishment_settings (
  shop_id uuid not null references public.shops(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  par_level_base bigint not null default 0 check (par_level_base >= 0),
  reorder_point_base bigint not null default 0 check (reorder_point_base >= 0),
  preferred_supplier_id uuid,
  preferred_purchase_unit text,
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  minimum_order_quantity_base bigint check (
    minimum_order_quantity_base is null or minimum_order_quantity_base > 0
  ),
  order_multiple_base bigint check (
    order_multiple_base is null or order_multiple_base > 0
  ),
  updated_by_employee_id uuid references public.business_employees(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, inventory_item_id),
  check (
    preferred_purchase_unit is null
    or btrim(preferred_purchase_unit) <> ''
  )
);

create index inventory_replenishment_settings_shop_reorder_idx
  on public.inventory_replenishment_settings(
    shop_id,
    reorder_point_base,
    inventory_item_id
  );

create table public.inventory_margin_settings (
  shop_id uuid not null references public.shops(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  target_food_cost_percent numeric(7, 3) not null default 30
    check (target_food_cost_percent >= 0 and target_food_cost_percent <= 100),
  alert_food_cost_percent numeric(7, 3) not null default 35
    check (
      alert_food_cost_percent >= target_food_cost_percent
      and alert_food_cost_percent <= 100
    ),
  updated_by_employee_id uuid references public.business_employees(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_id)
);

alter table public.inventory_replenishment_settings enable row level security;
alter table public.inventory_margin_settings enable row level security;

revoke all on public.inventory_replenishment_settings from public, anon, authenticated;
revoke all on public.inventory_margin_settings from public, anon, authenticated;
grant select, insert, update, delete on public.inventory_replenishment_settings to service_role;
grant select, insert, update, delete on public.inventory_margin_settings to service_role;

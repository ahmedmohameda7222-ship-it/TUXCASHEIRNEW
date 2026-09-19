-- TUX Admin Plan 4 Task 4: inventory intelligence configuration.
-- Reorder/variance/margin outputs are derived; only operator configuration is durable here.
-- preferred_supplier_id intentionally gains its suppliers FK in the Task 5 purchasing migration.

create table public.inventory_replenishment_settings (
  shop_id uuid not null references public.shops(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  par_level_micros bigint not null default 0 check (par_level_micros >= 0),
  reorder_point_micros bigint not null default 0 check (reorder_point_micros >= 0),
  preferred_supplier_id uuid,
  preferred_purchase_unit_label text,
  lead_time_days integer not null default 0 check (lead_time_days between 0 and 3650),
  minimum_order_micros bigint check (minimum_order_micros is null or minimum_order_micros > 0),
  order_multiple_micros bigint check (order_multiple_micros is null or order_multiple_micros > 0),
  updated_by_employee_id uuid references public.business_employees(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (shop_id, inventory_item_id),
  check (reorder_point_micros <= par_level_micros),
  check (
    preferred_purchase_unit_label is null
    or btrim(preferred_purchase_unit_label) <> ''
  )
);

create index inventory_replenishment_supplier_idx
  on public.inventory_replenishment_settings(shop_id, preferred_supplier_id)
  where preferred_supplier_id is not null;

create table public.inventory_margin_targets (
  shop_id uuid not null references public.shops(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  target_food_cost_percent numeric(7, 4) not null
    check (target_food_cost_percent >= 0 and target_food_cost_percent <= 100),
  alert_threshold_percentage_points numeric(7, 4) not null default 0
    check (
      alert_threshold_percentage_points >= 0
      and alert_threshold_percentage_points <= 100
    ),
  updated_by_employee_id uuid references public.business_employees(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_id)
);

alter table public.inventory_replenishment_settings enable row level security;
alter table public.inventory_margin_targets enable row level security;

revoke all on public.inventory_replenishment_settings from public, anon, authenticated;
revoke all on public.inventory_margin_targets from public, anon, authenticated;

grant select, insert, update, delete on public.inventory_replenishment_settings to service_role;
grant select, insert, update, delete on public.inventory_margin_targets to service_role;

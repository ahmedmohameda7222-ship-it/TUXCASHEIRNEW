-- TUX Operations V2 remote schema foundation.
-- Repository migration only. Do not apply to a remote project without explicit target authorization.

create table public.shops (
  id uuid primary key,
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.shop_memberships (
  id uuid primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'OPERATIONS_DEVICE')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, auth_user_id)
);
create index shop_memberships_auth_user_idx on public.shop_memberships(auth_user_id, active);

create table public.devices (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  label text not null check (btrim(label) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index devices_shop_idx on public.devices(shop_id, active);

create table public.workers (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  display_name text not null check (btrim(display_name) <> ''),
  pin_hash text not null check (btrim(pin_hash) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workers_shop_idx on public.workers(shop_id, active);

create table public.business_days (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  status text not null check (status in ('OPEN', 'CLOSED')),
  started_at timestamptz not null,
  ended_at timestamptz,
  started_by_worker_id uuid not null references public.workers(id),
  ended_by_worker_id uuid references public.workers(id),
  last_allocated_display_order_no integer not null default 0
    check (last_allocated_display_order_no >= 0),
  close_idempotency_key text,
  created_at timestamptz not null default now(),
  check (
    (status = 'OPEN' and ended_at is null and ended_by_worker_id is null) or
    (status = 'CLOSED' and ended_at is not null and ended_by_worker_id is not null)
  ),
  check (ended_at is null or ended_at >= started_at),
  unique (shop_id, close_idempotency_key)
);
create unique index business_days_one_open_per_shop_idx
  on public.business_days(shop_id)
  where status = 'OPEN';
create index business_days_shop_started_idx on public.business_days(shop_id, started_at desc);

create table public.worker_sessions (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid not null references public.business_days(id),
  worker_id uuid not null references public.workers(id),
  device_id uuid references public.devices(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index worker_sessions_business_day_idx on public.worker_sessions(business_day_id, started_at);

create table public.menu_categories (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);
create index menu_categories_shop_order_idx
  on public.menu_categories(shop_id, active, sort_order);

create table public.products (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  category_id uuid not null references public.menu_categories(id),
  name text not null check (btrim(name) <> ''),
  description text,
  price_minor bigint not null check (price_minor >= 0),
  image_key text,
  active boolean not null default true,
  sold_out boolean not null default false,
  sold_out_updated_at timestamptz,
  sold_out_by_worker_id uuid references public.workers(id),
  is_combo boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, category_id, name)
);
create index products_category_order_idx
  on public.products(shop_id, category_id, active, sort_order);

create table public.modifiers (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  name text not null check (btrim(name) <> ''),
  price_minor bigint not null check (price_minor >= 0),
  standalone_product_id uuid references public.products(id),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.product_modifiers (
  shop_id uuid not null references public.shops(id),
  product_id uuid not null references public.products(id) on delete cascade,
  modifier_id uuid not null references public.modifiers(id),
  max_quantity integer check (max_quantity is null or max_quantity > 0),
  sort_order integer not null,
  primary key (product_id, modifier_id)
);

create table public.combo_beverage_options (
  shop_id uuid not null references public.shops(id),
  combo_product_id uuid not null references public.products(id) on delete cascade,
  beverage_product_id uuid not null references public.products(id),
  sort_order integer not null,
  primary key (combo_product_id, beverage_product_id),
  check (combo_product_id <> beverage_product_id)
);

create table public.inventory_items (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  name text not null check (btrim(name) <> ''),
  unit_label text not null check (btrim(unit_label) <> ''),
  tracking_mode text not null check (tracking_mode in ('RECIPE_TRACKED', 'BULK_MANUAL')),
  low_stock_threshold_micros bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (low_stock_threshold_micros is null or low_stock_threshold_micros >= 0),
  unique (shop_id, name)
);
create index inventory_items_shop_tracking_idx
  on public.inventory_items(shop_id, tracking_mode, active);

create table public.recipe_lines (
  shop_id uuid not null references public.shops(id),
  product_id uuid not null references public.products(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity_micros bigint not null check (quantity_micros > 0),
  primary key (product_id, inventory_item_id)
);

create table public.order_types (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  name text not null check (btrim(name) <> ''),
  behavior text not null check (behavior in ('TAKE_AWAY', 'DINE_IN', 'DELIVERY', 'OTHER')),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.payment_methods (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  display_name text not null check (btrim(display_name) <> ''),
  logic_type text not null check (logic_type in ('CASH', 'CARD', 'DIGITAL', 'OTHER')),
  requires_reconciliation boolean not null default true,
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, display_name)
);

create table public.delivery_zones (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  name text not null check (btrim(name) <> ''),
  fee_minor bigint not null check (fee_minor >= 0),
  active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table public.customer_contacts (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  normalized_phone text not null check (btrim(normalized_phone) <> ''),
  display_phone text not null check (btrim(display_phone) <> ''),
  name text not null check (btrim(name) <> ''),
  latest_address text,
  latest_zone_id uuid references public.delivery_zones(id),
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, normalized_phone)
);

create table public.orders (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid not null references public.business_days(id),
  display_order_no integer not null check (display_order_no > 0),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  source text not null check (source in ('POS', 'ONLINE')),
  status text not null check (status in ('ACTIVE', 'DONE', 'CANCELLED', 'RETURNED')),
  operator_worker_id uuid not null references public.workers(id),
  operator_name_snapshot text not null,
  order_type_id uuid not null references public.order_types(id),
  order_type_label_snapshot text not null,
  order_type_behavior_snapshot text not null
    check (order_type_behavior_snapshot in ('TAKE_AWAY', 'DINE_IN', 'DELIVERY', 'OTHER')),
  customer_contact_id uuid references public.customer_contacts(id),
  customer_name_snapshot text,
  normalized_phone_snapshot text,
  address_snapshot text,
  delivery_zone_id uuid references public.delivery_zones(id),
  delivery_zone_label_snapshot text,
  configured_delivery_fee_minor bigint not null default 0
    check (configured_delivery_fee_minor >= 0),
  final_delivery_fee_minor bigint not null default 0
    check (final_delivery_fee_minor >= 0),
  items_subtotal_minor bigint not null check (items_subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  order_note text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  recognized_revenue_minor bigint not null check (recognized_revenue_minor >= 0),
  collected_payment_minor bigint not null check (collected_payment_minor >= 0),
  check (discount_minor <= items_subtotal_minor),
  check (total_minor = items_subtotal_minor - discount_minor + final_delivery_fee_minor),
  check (
    (order_type_behavior_snapshot = 'DELIVERY' and
      customer_name_snapshot is not null and
      normalized_phone_snapshot is not null and
      address_snapshot is not null and
      delivery_zone_id is not null and
      delivery_zone_label_snapshot is not null) or
    (order_type_behavior_snapshot <> 'DELIVERY' and
      customer_contact_id is null and
      customer_name_snapshot is null and
      normalized_phone_snapshot is null and
      address_snapshot is null and
      delivery_zone_id is null and
      delivery_zone_label_snapshot is null and
      configured_delivery_fee_minor = 0 and
      final_delivery_fee_minor = 0)
  ),
  unique (shop_id, business_day_id, display_order_no),
  unique (shop_id, idempotency_key)
);
create index orders_business_day_status_idx
  on public.orders(business_day_id, status, created_at);
create index orders_business_day_number_idx
  on public.orders(business_day_id, display_order_no);

create table public.order_items (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  item_note text,
  line_position integer not null check (line_position >= 0)
);
create index order_items_order_idx on public.order_items(order_id, line_position);

create table public.order_item_modifiers (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  modifier_id uuid not null references public.modifiers(id),
  modifier_label_snapshot text not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  position integer not null check (position >= 0)
);
create index order_item_modifiers_item_idx on public.order_item_modifiers(order_item_id, position);

create table public.order_item_combo_beverages (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  unit_index integer not null check (unit_index > 0),
  beverage_product_id uuid not null references public.products(id),
  beverage_label_snapshot text not null,
  unique (order_item_id, unit_index)
);

create table public.payments (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  order_id uuid not null references public.orders(id) on delete restrict,
  part_index integer not null check (part_index in (1, 2)),
  payment_method_id uuid not null references public.payment_methods(id),
  payment_method_label_snapshot text not null,
  logic_type_snapshot text not null check (logic_type_snapshot in ('CASH', 'CARD', 'DIGITAL', 'OTHER')),
  allocated_minor bigint not null check (allocated_minor >= 0),
  received_minor bigint,
  change_minor bigint,
  created_at timestamptz not null,
  check (
    (logic_type_snapshot = 'CASH' and
      received_minor is not null and
      change_minor is not null and
      received_minor >= allocated_minor and
      change_minor = received_minor - allocated_minor) or
    (logic_type_snapshot <> 'CASH' and received_minor is null and change_minor is null)
  ),
  unique (order_id, part_index),
  unique (order_id, payment_method_id)
);
create index payments_order_idx on public.payments(order_id);

create table public.order_status_events (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid not null references public.business_days(id),
  order_id uuid not null references public.orders(id) on delete restrict,
  event_type text not null
    check (event_type in ('PLACED', 'MARKED_DONE', 'DONE_UNDONE', 'CANCELLED', 'DELIVERY_RETURNED')),
  worker_id uuid not null references public.workers(id),
  reason text,
  restore_stock boolean,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null,
  unique (shop_id, idempotency_key)
);
create index order_status_events_order_idx on public.order_status_events(order_id, created_at);

create table public.expenses (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid not null references public.business_days(id),
  kind text not null check (kind in ('MANUAL', 'DELIVERY_FAILED')),
  description text not null check (btrim(description) <> ''),
  amount_minor bigint,
  paid_from text check (paid_from in ('CASH', 'OTHER')),
  note text,
  order_id uuid references public.orders(id),
  created_by_worker_id uuid not null references public.workers(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (
    (kind = 'MANUAL' and amount_minor is not null and amount_minor >= 0 and paid_from is not null and order_id is null) or
    (kind = 'DELIVERY_FAILED' and amount_minor is null and paid_from is null and order_id is not null)
  )
);
create unique index expenses_delivery_failed_order_idx
  on public.expenses(order_id)
  where kind = 'DELIVERY_FAILED';
create index expenses_business_day_idx on public.expenses(business_day_id, created_at desc);

create table public.inventory_movements (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid references public.business_days(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  movement_type text not null check (
    movement_type in (
      'ORDER_CONSUMPTION',
      'CANCEL_RESTOCK',
      'BULK_UNIT_FINISHED',
      'BULK_STOCK_RECEIVED',
      'UNDO_BULK_UNIT_FINISHED',
      'UNDO_BULK_STOCK_RECEIVED',
      'ADMIN_ADJUSTMENT'
    )
  ),
  quantity_delta_micros bigint not null check (quantity_delta_micros <> 0),
  worker_id uuid not null references public.workers(id),
  order_id uuid references public.orders(id),
  compensates_movement_id uuid references public.inventory_movements(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null,
  unique (shop_id, idempotency_key)
);
create index inventory_movements_item_idx
  on public.inventory_movements(inventory_item_id, created_at);
create index inventory_movements_business_day_idx
  on public.inventory_movements(business_day_id, created_at);

create table public.reconciliations (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid not null references public.business_days(id),
  created_by_worker_id uuid not null references public.workers(id),
  created_at timestamptz not null,
  unique (shop_id, business_day_id)
);

create table public.reconciliation_lines (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  reconciliation_id uuid not null references public.reconciliations(id) on delete restrict,
  payment_method_id uuid not null references public.payment_methods(id),
  payment_method_label_snapshot text not null,
  logic_type_snapshot text not null check (logic_type_snapshot in ('CASH', 'CARD', 'DIGITAL', 'OTHER')),
  expected_minor bigint not null,
  actual_minor bigint not null,
  difference_minor bigint not null,
  variance_reason text,
  check (difference_minor = actual_minor - expected_minor),
  check (difference_minor = 0 or btrim(coalesce(variance_reason, '')) <> ''),
  unique (reconciliation_id, payment_method_id)
);

create table public.audit_events (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  business_day_id uuid references public.business_days(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  worker_id uuid references public.workers(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);
create index audit_events_aggregate_idx
  on public.audit_events(aggregate_type, aggregate_id, created_at);
create index audit_events_business_day_idx
  on public.audit_events(business_day_id, created_at);

-- RLS is deliberately enabled with no permissive client policies in this migration.
-- The real V2 authentication/device authorization model will add reviewed policies later.
alter table public.shops enable row level security;
alter table public.shop_memberships enable row level security;
alter table public.devices enable row level security;
alter table public.workers enable row level security;
alter table public.business_days enable row level security;
alter table public.worker_sessions enable row level security;
alter table public.menu_categories enable row level security;
alter table public.products enable row level security;
alter table public.modifiers enable row level security;
alter table public.product_modifiers enable row level security;
alter table public.combo_beverage_options enable row level security;
alter table public.inventory_items enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.order_types enable row level security;
alter table public.payment_methods enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_item_combo_beverages enable row level security;
alter table public.payments enable row level security;
alter table public.order_status_events enable row level security;
alter table public.expenses enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.reconciliations enable row level security;
alter table public.reconciliation_lines enable row level security;
alter table public.audit_events enable row level security;

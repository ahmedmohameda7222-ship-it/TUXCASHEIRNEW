-- Strengthen shop/tenant consistency for every relationship that also carries shop_id.
-- Repository migration only. Do not apply remotely without explicit V2 target authorization.

-- Derived revenue/collection are intentionally not stored as mutable duplicate facts.
-- Reports/reconciliation derive eligibility from immutable order/payment/status history.
alter table public.orders
  drop column recognized_revenue_minor,
  drop column collected_payment_minor;

-- Composite unique keys make tenant-scoped foreign keys enforceable.
alter table public.devices add constraint devices_shop_id_id_unique unique (shop_id, id);
alter table public.workers add constraint workers_shop_id_id_unique unique (shop_id, id);
alter table public.business_days add constraint business_days_shop_id_id_unique unique (shop_id, id);
alter table public.worker_sessions add constraint worker_sessions_shop_id_id_unique unique (shop_id, id);
alter table public.menu_categories add constraint menu_categories_shop_id_id_unique unique (shop_id, id);
alter table public.products add constraint products_shop_id_id_unique unique (shop_id, id);
alter table public.modifiers add constraint modifiers_shop_id_id_unique unique (shop_id, id);
alter table public.inventory_items add constraint inventory_items_shop_id_id_unique unique (shop_id, id);
alter table public.order_types add constraint order_types_shop_id_id_unique unique (shop_id, id);
alter table public.payment_methods add constraint payment_methods_shop_id_id_unique unique (shop_id, id);
alter table public.delivery_zones add constraint delivery_zones_shop_id_id_unique unique (shop_id, id);
alter table public.customer_contacts add constraint customer_contacts_shop_id_id_unique unique (shop_id, id);
alter table public.orders add constraint orders_shop_id_id_unique unique (shop_id, id);
alter table public.order_items add constraint order_items_shop_id_id_unique unique (shop_id, id);
alter table public.order_item_modifiers add constraint order_item_modifiers_shop_id_id_unique unique (shop_id, id);
alter table public.order_item_combo_beverages add constraint order_item_combo_beverages_shop_id_id_unique unique (shop_id, id);
alter table public.payments add constraint payments_shop_id_id_unique unique (shop_id, id);
alter table public.order_status_events add constraint order_status_events_shop_id_id_unique unique (shop_id, id);
alter table public.expenses add constraint expenses_shop_id_id_unique unique (shop_id, id);
alter table public.inventory_movements add constraint inventory_movements_shop_id_id_unique unique (shop_id, id);
alter table public.reconciliations add constraint reconciliations_shop_id_id_unique unique (shop_id, id);
alter table public.reconciliation_lines add constraint reconciliation_lines_shop_id_id_unique unique (shop_id, id);
alter table public.audit_events add constraint audit_events_shop_id_id_unique unique (shop_id, id);

-- Business Day/operator identity must stay in one shop.
alter table public.business_days
  add constraint business_days_started_by_same_shop_fk
    foreign key (shop_id, started_by_worker_id) references public.workers(shop_id, id),
  add constraint business_days_ended_by_same_shop_fk
    foreign key (shop_id, ended_by_worker_id) references public.workers(shop_id, id);

alter table public.worker_sessions
  add constraint worker_sessions_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint worker_sessions_worker_same_shop_fk
    foreign key (shop_id, worker_id) references public.workers(shop_id, id),
  add constraint worker_sessions_device_same_shop_fk
    foreign key (shop_id, device_id) references public.devices(shop_id, id);

-- Configuration relationships must not cross tenant boundaries.
alter table public.products
  add constraint products_category_same_shop_fk
    foreign key (shop_id, category_id) references public.menu_categories(shop_id, id),
  add constraint products_sold_out_worker_same_shop_fk
    foreign key (shop_id, sold_out_by_worker_id) references public.workers(shop_id, id);

alter table public.modifiers
  add constraint modifiers_standalone_product_same_shop_fk
    foreign key (shop_id, standalone_product_id) references public.products(shop_id, id);

alter table public.product_modifiers
  add constraint product_modifiers_product_same_shop_fk
    foreign key (shop_id, product_id) references public.products(shop_id, id),
  add constraint product_modifiers_modifier_same_shop_fk
    foreign key (shop_id, modifier_id) references public.modifiers(shop_id, id);

alter table public.combo_beverage_options
  add constraint combo_beverage_combo_same_shop_fk
    foreign key (shop_id, combo_product_id) references public.products(shop_id, id),
  add constraint combo_beverage_product_same_shop_fk
    foreign key (shop_id, beverage_product_id) references public.products(shop_id, id);

alter table public.recipe_lines
  add constraint recipe_lines_product_same_shop_fk
    foreign key (shop_id, product_id) references public.products(shop_id, id),
  add constraint recipe_lines_inventory_same_shop_fk
    foreign key (shop_id, inventory_item_id) references public.inventory_items(shop_id, id);

alter table public.customer_contacts
  add constraint customer_contacts_zone_same_shop_fk
    foreign key (shop_id, latest_zone_id) references public.delivery_zones(shop_id, id);

-- Operational facts must reference only entities owned by the same shop.
alter table public.orders
  add constraint orders_business_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint orders_operator_same_shop_fk
    foreign key (shop_id, operator_worker_id) references public.workers(shop_id, id),
  add constraint orders_order_type_same_shop_fk
    foreign key (shop_id, order_type_id) references public.order_types(shop_id, id),
  add constraint orders_customer_same_shop_fk
    foreign key (shop_id, customer_contact_id) references public.customer_contacts(shop_id, id),
  add constraint orders_delivery_zone_same_shop_fk
    foreign key (shop_id, delivery_zone_id) references public.delivery_zones(shop_id, id);

alter table public.order_items
  add constraint order_items_order_same_shop_fk
    foreign key (shop_id, order_id) references public.orders(shop_id, id),
  add constraint order_items_product_same_shop_fk
    foreign key (shop_id, product_id) references public.products(shop_id, id);

alter table public.order_item_modifiers
  add constraint order_item_modifiers_item_same_shop_fk
    foreign key (shop_id, order_item_id) references public.order_items(shop_id, id),
  add constraint order_item_modifiers_modifier_same_shop_fk
    foreign key (shop_id, modifier_id) references public.modifiers(shop_id, id);

alter table public.order_item_combo_beverages
  add constraint order_item_combo_item_same_shop_fk
    foreign key (shop_id, order_item_id) references public.order_items(shop_id, id),
  add constraint order_item_combo_product_same_shop_fk
    foreign key (shop_id, beverage_product_id) references public.products(shop_id, id);

alter table public.payments
  add constraint payments_order_same_shop_fk
    foreign key (shop_id, order_id) references public.orders(shop_id, id),
  add constraint payments_method_same_shop_fk
    foreign key (shop_id, payment_method_id) references public.payment_methods(shop_id, id);

alter table public.order_status_events
  add constraint order_status_events_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint order_status_events_order_same_shop_fk
    foreign key (shop_id, order_id) references public.orders(shop_id, id),
  add constraint order_status_events_worker_same_shop_fk
    foreign key (shop_id, worker_id) references public.workers(shop_id, id);

alter table public.expenses
  add constraint expenses_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint expenses_order_same_shop_fk
    foreign key (shop_id, order_id) references public.orders(shop_id, id),
  add constraint expenses_worker_same_shop_fk
    foreign key (shop_id, created_by_worker_id) references public.workers(shop_id, id);

alter table public.inventory_movements
  add constraint inventory_movements_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint inventory_movements_item_same_shop_fk
    foreign key (shop_id, inventory_item_id) references public.inventory_items(shop_id, id),
  add constraint inventory_movements_worker_same_shop_fk
    foreign key (shop_id, worker_id) references public.workers(shop_id, id),
  add constraint inventory_movements_order_same_shop_fk
    foreign key (shop_id, order_id) references public.orders(shop_id, id),
  add constraint inventory_movements_compensates_same_shop_fk
    foreign key (shop_id, compensates_movement_id) references public.inventory_movements(shop_id, id);

alter table public.reconciliations
  add constraint reconciliations_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint reconciliations_worker_same_shop_fk
    foreign key (shop_id, created_by_worker_id) references public.workers(shop_id, id);

alter table public.reconciliation_lines
  add constraint reconciliation_lines_header_same_shop_fk
    foreign key (shop_id, reconciliation_id) references public.reconciliations(shop_id, id),
  add constraint reconciliation_lines_method_same_shop_fk
    foreign key (shop_id, payment_method_id) references public.payment_methods(shop_id, id);

alter table public.audit_events
  add constraint audit_events_day_same_shop_fk
    foreign key (shop_id, business_day_id) references public.business_days(shop_id, id),
  add constraint audit_events_worker_same_shop_fk
    foreign key (shop_id, worker_id) references public.workers(shop_id, id);

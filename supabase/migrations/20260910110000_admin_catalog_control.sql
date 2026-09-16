-- TUX Admin Plan 2 catalog control plane.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Existing shop catalog rows and Operations configuration snapshots remain the live authorities.

create table public.catalog_master_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  canonical_name text not null check (btrim(canonical_name) <> ''),
  description text,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

-- A category master may later bind to more than one shop while every existing
-- canonical category UUID remains stable for historical and customer-facing references.
create table public.catalog_category_shop_bindings (
  business_id uuid not null,
  master_category_id uuid not null,
  shop_id uuid not null,
  canonical_category_id uuid not null references public.menu_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (master_category_id, shop_id),
  unique (canonical_category_id),
  foreign key (business_id, master_category_id)
    references public.catalog_master_categories(business_id, id) on delete restrict,
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.catalog_master_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  master_category_id uuid not null,
  canonical_name text not null check (btrim(canonical_name) <> ''),
  description text,
  image_key text,
  archived_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, master_category_id)
    references public.catalog_master_categories(business_id, id) on delete restrict
);

create table public.catalog_product_shop_overrides (
  business_id uuid not null,
  master_product_id uuid not null,
  shop_id uuid not null,
  canonical_product_id uuid not null references public.products(id) on delete restrict,
  price_minor bigint not null check (price_minor >= 0),
  visible boolean not null default true,
  manual_sold_out boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (master_product_id, shop_id),
  unique (canonical_product_id),
  foreign key (business_id, master_product_id)
    references public.catalog_master_products(business_id, id) on delete restrict,
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.catalog_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  created_by_employee_id uuid not null,
  title text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PUBLISHED', 'DISCARDED')),
  base_publish_version bigint not null check (base_publish_version >= 0),
  draft_revision bigint not null default 1 check (draft_revision > 0),
  working_bundle_json jsonb not null check (jsonb_typeof(working_bundle_json) = 'object'),
  published_version bigint,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  check (
    (status = 'PUBLISHED' and published_version is not null and published_at is not null)
    or (status <> 'PUBLISHED' and published_version is null and published_at is null)
  )
);
create index catalog_drafts_shop_status_idx
  on public.catalog_drafts(shop_id, status, updated_at desc);

create table public.catalog_draft_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  draft_id uuid not null,
  sequence bigint not null check (sequence > 0),
  employee_id uuid not null,
  expected_draft_revision bigint not null check (expected_draft_revision > 0),
  change_json jsonb not null check (jsonb_typeof(change_json) = 'object'),
  resulting_bundle_json jsonb not null check (jsonb_typeof(resulting_bundle_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (draft_id, sequence),
  foreign key (business_id, draft_id)
    references public.catalog_drafts(business_id, id) on delete restrict,
  foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict
);
create index catalog_draft_changes_draft_idx
  on public.catalog_draft_changes(draft_id, sequence);

create table public.catalog_publish_versions (
  business_id uuid not null,
  shop_id uuid not null,
  publish_version bigint not null check (publish_version > 0),
  operations_configuration_version integer not null check (operations_configuration_version > 0),
  source_kind text not null
    check (source_kind in ('BASELINE', 'DRAFT', 'IMMEDIATE_AVAILABILITY', 'SCHEDULE', 'ROLLBACK')),
  draft_id uuid,
  published_by_employee_id uuid,
  bundle_json jsonb not null check (jsonb_typeof(bundle_json) = 'object'),
  published_at timestamptz not null default now(),
  primary key (shop_id, publish_version),
  unique (shop_id, operations_configuration_version),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, draft_id)
    references public.catalog_drafts(business_id, id) on delete restrict,
  foreign key (business_id, published_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  check ((source_kind = 'DRAFT') = (draft_id is not null))
);
create index catalog_publish_versions_shop_latest_idx
  on public.catalog_publish_versions(shop_id, publish_version desc);

create table public.scheduled_config_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  created_by_employee_id uuid not null,
  change_kind text not null
    check (change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY', 'SHOP_CONFIG')),
  payload_json jsonb not null check (jsonb_typeof(payload_json) = 'object'),
  timezone text not null default 'Africa/Cairo' check (timezone = 'Africa/Cairo'),
  local_scheduled_at timestamp without time zone not null,
  scheduled_for timestamptz not null,
  target_base_publish_version bigint check (target_base_publish_version is null or target_base_publish_version >= 0),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'CLAIMED', 'APPLIED', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claimed_at timestamptz,
  applied_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  check (scheduled_for = local_scheduled_at at time zone timezone),
  check (applied_at is null or status = 'APPLIED')
);
create index scheduled_config_changes_due_idx
  on public.scheduled_config_changes(status, scheduled_for)
  where status in ('PENDING', 'FAILED');

create table public.recurring_availability_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  master_product_id uuid not null,
  created_by_employee_id uuid not null,
  timezone text not null default 'Africa/Cairo' check (timezone = 'Africa/Cairo'),
  days_of_week smallint[] not null,
  start_local time without time zone not null,
  end_local time without time zone not null,
  available boolean not null default true,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, master_product_id)
    references public.catalog_master_products(business_id, id) on delete restrict,
  foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  check (cardinality(days_of_week) between 1 and 7),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (start_local <> end_local)
);
create index recurring_availability_rules_shop_active_idx
  on public.recurring_availability_rules(shop_id, active, master_product_id);

-- All Admin-owned relations are private to the trusted same-origin BFF/service role.
alter table public.catalog_master_categories enable row level security;
alter table public.catalog_category_shop_bindings enable row level security;
alter table public.catalog_master_products enable row level security;
alter table public.catalog_product_shop_overrides enable row level security;
alter table public.catalog_drafts enable row level security;
alter table public.catalog_draft_changes enable row level security;
alter table public.catalog_publish_versions enable row level security;
alter table public.scheduled_config_changes enable row level security;
alter table public.recurring_availability_rules enable row level security;

revoke all on public.catalog_master_categories from public, anon, authenticated;
revoke all on public.catalog_category_shop_bindings from public, anon, authenticated;
revoke all on public.catalog_master_products from public, anon, authenticated;
revoke all on public.catalog_product_shop_overrides from public, anon, authenticated;
revoke all on public.catalog_drafts from public, anon, authenticated;
revoke all on public.catalog_draft_changes from public, anon, authenticated;
revoke all on public.catalog_publish_versions from public, anon, authenticated;
revoke all on public.scheduled_config_changes from public, anon, authenticated;
revoke all on public.recurring_availability_rules from public, anon, authenticated;

-- Build a complete Operations-compatible bundle from current canonical rows. This is the
-- single bridge used by draft creation and immediate availability so newer catalog fields
-- cannot be lost by cloning an old snapshot shape.
create or replace function private.build_admin_catalog_bundle_v1(
  p_shop_id uuid,
  p_version integer,
  p_updated_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'snapshot', jsonb_build_object(
      'shopId', p_shop_id,
      'version', p_version,
      'updatedAt', p_updated_at,
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id,
          'shopId', c.shop_id,
          'slug', c.slug,
          'name', c.name,
          'description', c.description,
          'sortOrder', c.sort_order,
          'active', c.active
        ) order by c.sort_order, c.id)
        from public.menu_categories c
        where c.shop_id = p_shop_id
      ), '[]'::jsonb),
      'products', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'shopId', p.shop_id,
          'categoryId', p.category_id,
          'slug', p.slug,
          'name', p.name,
          'description', p.description,
          'priceMinor', p.price_minor,
          'imageKey', p.image_key,
          'family', p.family,
          'bestSeller', p.best_seller,
          'active', p.active,
          'soldOut', p.sold_out,
          'isCombo', p.is_combo,
          'sortOrder', p.sort_order
        ) order by p.category_id, p.sort_order, p.id)
        from public.products p
        where p.shop_id = p_shop_id
      ), '[]'::jsonb),
      'modifiers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id,
          'shopId', m.shop_id,
          'name', m.name,
          'priceMinor', m.price_minor,
          'standaloneProductId', m.standalone_product_id,
          'active', m.active,
          'sortOrder', m.sort_order
        ) order by m.sort_order, m.id)
        from public.modifiers m
        where m.shop_id = p_shop_id
      ), '[]'::jsonb),
      'productModifierLinks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'shopId', pm.shop_id,
          'productId', pm.product_id,
          'modifierId', pm.modifier_id,
          'maxQuantity', pm.max_quantity,
          'sortOrder', pm.sort_order
        ) order by pm.product_id, pm.sort_order, pm.modifier_id)
        from public.product_modifiers pm
        where pm.shop_id = p_shop_id
      ), '[]'::jsonb),
      'comboBeverageOptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'shopId', cbo.shop_id,
          'comboProductId', cbo.combo_product_id,
          'beverageProductId', cbo.beverage_product_id,
          'sortOrder', cbo.sort_order
        ) order by cbo.combo_product_id, cbo.sort_order, cbo.beverage_product_id)
        from public.combo_beverage_options cbo
        where cbo.shop_id = p_shop_id
      ), '[]'::jsonb),
      'recipeLines', coalesce((
        select jsonb_agg(jsonb_build_object(
          'shopId', rl.shop_id,
          'productId', rl.product_id,
          'inventoryItemId', rl.inventory_item_id,
          'quantityMicros', rl.quantity_micros
        ) order by rl.product_id, rl.inventory_item_id)
        from public.recipe_lines rl
        where rl.shop_id = p_shop_id
      ), '[]'::jsonb),
      'orderTypes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ot.id,
          'shopId', ot.shop_id,
          'name', ot.name,
          'behavior', ot.behavior,
          'active', ot.active,
          'sortOrder', ot.sort_order
        ) order by ot.sort_order, ot.id)
        from public.order_types ot
        where ot.shop_id = p_shop_id
      ), '[]'::jsonb),
      'paymentMethods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pm.id,
          'shopId', pm.shop_id,
          'displayName', pm.display_name,
          'logicType', pm.logic_type,
          'requiresReconciliation', pm.requires_reconciliation,
          'active', pm.active,
          'sortOrder', pm.sort_order
        ) order by pm.sort_order, pm.id)
        from public.payment_methods pm
        where pm.shop_id = p_shop_id
      ), '[]'::jsonb),
      'deliveryZones', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', dz.id,
          'shopId', dz.shop_id,
          'name', dz.name,
          'feeMinor', dz.fee_minor,
          'active', dz.active,
          'sortOrder', dz.sort_order
        ) order by dz.sort_order, dz.id)
        from public.delivery_zones dz
        where dz.shop_id = p_shop_id
      ), '[]'::jsonb)
    ),
    'inventoryItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ii.id,
        'shopId', ii.shop_id,
        'name', ii.name,
        'unitLabel', ii.unit_label,
        'trackingMode', ii.tracking_mode,
        'active', ii.active
      ) order by ii.name, ii.id)
      from public.inventory_items ii
      where ii.shop_id = p_shop_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.build_admin_catalog_bundle_v1(uuid, integer, timestamptz)
  from public, anon, authenticated;

create or replace function private.assert_admin_catalog_permission_v1(
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
  v_denial_code text;
begin
  select r.authorized, r.business_id, r.denial_code
    into v_authorized, v_business_id, v_denial_code
  from public.resolve_admin_authorization_v1(p_employee_id, p_shop_id, p_permission) r;

  if not coalesce(v_authorized, false) or v_business_id is null then
    raise exception 'TUX_ADMIN_CATALOG_FORBIDDEN:%', coalesce(v_denial_code, 'unknown');
  end if;

  if not exists (
    select 1 from public.business_shops bs
    where bs.business_id = v_business_id and bs.shop_id = p_shop_id
  ) then
    raise exception 'TUX_ADMIN_CATALOG_SHOP_FORBIDDEN';
  end if;

  return v_business_id;
end;
$$;

revoke all on function private.assert_admin_catalog_permission_v1(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function private.validate_admin_catalog_bundle_v1(
  p_shop_id uuid,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
  v_count bigint;
  v_distinct_count bigint;
begin
  if jsonb_typeof(p_bundle) <> 'object' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;
  v_snapshot := p_bundle -> 'snapshot';
  if jsonb_typeof(v_snapshot) <> 'object' then
    raise exception 'TUX_ADMIN_CATALOG_SNAPSHOT_INVALID';
  end if;
  if coalesce(v_snapshot ->> 'shopId', '') <> p_shop_id::text then
    raise exception 'TUX_ADMIN_CATALOG_SHOP_MISMATCH';
  end if;

  if coalesce(jsonb_typeof(v_snapshot -> 'categories'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'products'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'modifiers'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'productModifierLinks'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'comboBeverageOptions'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'recipeLines'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'orderTypes'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'paymentMethods'), '') <> 'array'
    or coalesce(jsonb_typeof(v_snapshot -> 'deliveryZones'), '') <> 'array'
    or coalesce(jsonb_typeof(p_bundle -> 'inventoryItems'), '') <> 'array' then
    raise exception 'TUX_ADMIN_CATALOG_ARRAYS_REQUIRED';
  end if;

  select count(*), count(distinct x.id)
    into v_count, v_distinct_count
  from jsonb_to_recordset(v_snapshot -> 'categories') as x(id uuid, "shopId" uuid);
  if v_count <> v_distinct_count then raise exception 'TUX_ADMIN_CATALOG_DUPLICATE_CATEGORY'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'categories') as x(id uuid, "shopId" uuid)
    where x.id is null or x."shopId" is distinct from p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_CATEGORY_INVALID'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'categories') as x(id uuid)
    join public.menu_categories c on c.id = x.id
    where c.shop_id <> p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_CATEGORY_CROSS_SHOP'; end if;

  select count(*), count(distinct x.id)
    into v_count, v_distinct_count
  from jsonb_to_recordset(v_snapshot -> 'products') as x(id uuid, "shopId" uuid);
  if v_count <> v_distinct_count then raise exception 'TUX_ADMIN_CATALOG_DUPLICATE_PRODUCT'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'products') as x(
      id uuid, "shopId" uuid, "categoryId" uuid, "priceMinor" bigint
    )
    where x.id is null or x."shopId" is distinct from p_shop_id
      or x."categoryId" is null or x."priceMinor" is null or x."priceMinor" < 0
  ) then raise exception 'TUX_ADMIN_CATALOG_PRODUCT_INVALID'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'products') as x(id uuid)
    join public.products p on p.id = x.id
    where p.shop_id <> p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_PRODUCT_CROSS_SHOP'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'products') as p("categoryId" uuid)
    left join jsonb_to_recordset(v_snapshot -> 'categories') as c(id uuid)
      on c.id = p."categoryId"
    where c.id is null
  ) then raise exception 'TUX_ADMIN_CATALOG_PRODUCT_CATEGORY_INVALID'; end if;

  select count(*), count(distinct x.id)
    into v_count, v_distinct_count
  from jsonb_to_recordset(v_snapshot -> 'modifiers') as x(id uuid, "shopId" uuid);
  if v_count <> v_distinct_count then raise exception 'TUX_ADMIN_CATALOG_DUPLICATE_MODIFIER'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'modifiers') as x(
      id uuid, "shopId" uuid, "standaloneProductId" uuid, "priceMinor" bigint
    )
    where x.id is null or x."shopId" is distinct from p_shop_id
      or x."priceMinor" is null or x."priceMinor" < 0
      or (
        x."standaloneProductId" is not null and not exists (
          select 1 from jsonb_to_recordset(v_snapshot -> 'products') as p(id uuid)
          where p.id = x."standaloneProductId"
        )
      )
  ) then raise exception 'TUX_ADMIN_CATALOG_MODIFIER_INVALID'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'modifiers') as x(id uuid)
    join public.modifiers m on m.id = x.id
    where m.shop_id <> p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_MODIFIER_CROSS_SHOP'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'productModifierLinks') as x(
      "shopId" uuid, "productId" uuid, "modifierId" uuid, "maxQuantity" integer
    )
    where x."shopId" is distinct from p_shop_id
      or not exists (
        select 1 from jsonb_to_recordset(v_snapshot -> 'products') as p(id uuid)
        where p.id = x."productId"
      )
      or not exists (
        select 1 from jsonb_to_recordset(v_snapshot -> 'modifiers') as m(id uuid)
        where m.id = x."modifierId"
      )
      or (x."maxQuantity" is not null and x."maxQuantity" <= 0)
  ) then raise exception 'TUX_ADMIN_CATALOG_PRODUCT_MODIFIER_INVALID'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'comboBeverageOptions') as x(
      "shopId" uuid, "comboProductId" uuid, "beverageProductId" uuid
    )
    where x."shopId" is distinct from p_shop_id
      or x."comboProductId" = x."beverageProductId"
      or not exists (
        select 1 from jsonb_to_recordset(v_snapshot -> 'products') as p(id uuid, "isCombo" boolean)
        where p.id = x."comboProductId" and p."isCombo" = true
      )
      or not exists (
        select 1 from jsonb_to_recordset(v_snapshot -> 'products') as p(id uuid)
        where p.id = x."beverageProductId"
      )
  ) then raise exception 'TUX_ADMIN_CATALOG_COMBO_INVALID'; end if;

  select count(*), count(distinct x.id)
    into v_count, v_distinct_count
  from jsonb_to_recordset(p_bundle -> 'inventoryItems') as x(id uuid, "shopId" uuid);
  if v_count <> v_distinct_count then raise exception 'TUX_ADMIN_CATALOG_DUPLICATE_INVENTORY_ITEM'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_bundle -> 'inventoryItems') as x(id uuid, "shopId" uuid)
    where x.id is null or x."shopId" is distinct from p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_INVENTORY_ITEM_INVALID'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_bundle -> 'inventoryItems') as x(id uuid)
    join public.inventory_items i on i.id = x.id
    where i.shop_id <> p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_INVENTORY_CROSS_SHOP'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_snapshot -> 'recipeLines') as x(
      "shopId" uuid, "productId" uuid, "inventoryItemId" uuid, "quantityMicros" bigint
    )
    where x."shopId" is distinct from p_shop_id
      or x."quantityMicros" is null or x."quantityMicros" <= 0
      or not exists (
        select 1 from jsonb_to_recordset(v_snapshot -> 'products') as p(id uuid)
        where p.id = x."productId"
      )
      or not exists (
        select 1 from jsonb_to_recordset(p_bundle -> 'inventoryItems') as i(id uuid)
        where i.id = x."inventoryItemId"
      )
  ) then raise exception 'TUX_ADMIN_CATALOG_RECIPE_INVALID'; end if;

  if exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'orderTypes') as x(id uuid, "shopId" uuid)
    where x.id is null or x."shopId" is distinct from p_shop_id
  ) or exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'paymentMethods') as x(id uuid, "shopId" uuid)
    where x.id is null or x."shopId" is distinct from p_shop_id
  ) or exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'deliveryZones') as x(id uuid, "shopId" uuid)
    where x.id is null or x."shopId" is distinct from p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_CONFIG_ENTITY_INVALID'; end if;

  if exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'orderTypes') as x(id uuid)
    join public.order_types ot on ot.id = x.id where ot.shop_id <> p_shop_id
  ) or exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'paymentMethods') as x(id uuid)
    join public.payment_methods pm on pm.id = x.id where pm.shop_id <> p_shop_id
  ) or exists (
    select 1 from jsonb_to_recordset(v_snapshot -> 'deliveryZones') as x(id uuid)
    join public.delivery_zones dz on dz.id = x.id where dz.shop_id <> p_shop_id
  ) then raise exception 'TUX_ADMIN_CATALOG_CONFIG_CROSS_SHOP'; end if;
end;
$$;

revoke all on function private.validate_admin_catalog_bundle_v1(uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.normalize_admin_catalog_bundle_v1(
  p_shop_id uuid,
  p_version integer,
  p_updated_at timestamptz,
  p_bundle jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_bundle jsonb := p_bundle;
begin
  v_bundle := jsonb_set(v_bundle, '{snapshot,shopId}', to_jsonb(p_shop_id::text), true);
  v_bundle := jsonb_set(v_bundle, '{snapshot,version}', to_jsonb(p_version), true);
  v_bundle := jsonb_set(v_bundle, '{snapshot,updatedAt}', to_jsonb(p_updated_at), true);
  return v_bundle;
end;
$$;

revoke all on function private.normalize_admin_catalog_bundle_v1(uuid, integer, timestamptz, jsonb)
  from public, anon, authenticated;

create or replace function private.materialize_admin_catalog_extended_fields_v1(
  p_shop_id uuid,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.menu_categories c
  set slug = x.slug,
      description = x.description,
      updated_at = now()
  from jsonb_to_recordset(p_bundle -> 'snapshot' -> 'categories') as x(
    id uuid, slug text, description text
  )
  where c.id = x.id and c.shop_id = p_shop_id;

  update public.products p
  set slug = x.slug,
      best_seller = coalesce(x."bestSeller", false),
      family = x.family,
      updated_at = now()
  from jsonb_to_recordset(p_bundle -> 'snapshot' -> 'products') as x(
    id uuid, slug text, "bestSeller" boolean, family text
  )
  where p.id = x.id and p.shop_id = p_shop_id;
end;
$$;

revoke all on function private.materialize_admin_catalog_extended_fields_v1(uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.sync_admin_master_catalog_v1(
  p_business_id uuid,
  p_shop_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.catalog_master_categories(
    id, business_id, canonical_name, description, archived_at, version
  )
  select c.id, p_business_id, c.name, c.description,
         case when c.active then null else now() end,
         1
  from public.menu_categories c
  where c.shop_id = p_shop_id
    and not exists (
      select 1 from public.catalog_category_shop_bindings b
      where b.canonical_category_id = c.id
    )
  on conflict (id) do nothing;

  insert into public.catalog_category_shop_bindings(
    business_id, master_category_id, shop_id, canonical_category_id
  )
  select p_business_id, c.id, p_shop_id, c.id
  from public.menu_categories c
  where c.shop_id = p_shop_id
    and not exists (
      select 1 from public.catalog_category_shop_bindings b
      where b.canonical_category_id = c.id
    )
  on conflict do nothing;

  update public.catalog_master_categories mc
  set canonical_name = c.name,
      description = c.description,
      archived_at = case when c.active then null else coalesce(mc.archived_at, now()) end,
      version = mc.version + case
        when mc.canonical_name is distinct from c.name
          or mc.description is distinct from c.description
          or (mc.archived_at is null) = c.active
        then 1 else 0 end,
      updated_at = now()
  from public.catalog_category_shop_bindings b
  join public.menu_categories c on c.id = b.canonical_category_id and c.shop_id = b.shop_id
  where b.business_id = p_business_id
    and b.shop_id = p_shop_id
    and mc.id = b.master_category_id
    and mc.business_id = b.business_id;

  insert into public.catalog_master_products(
    id, business_id, master_category_id, canonical_name, description, image_key, archived_at, version
  )
  select p.id, p_business_id, cb.master_category_id, p.name, p.description, p.image_key,
         case when p.active then null else now() end,
         1
  from public.products p
  join public.catalog_category_shop_bindings cb
    on cb.shop_id = p.shop_id and cb.canonical_category_id = p.category_id
  where p.shop_id = p_shop_id
    and not exists (
      select 1 from public.catalog_product_shop_overrides o
      where o.canonical_product_id = p.id
    )
  on conflict (id) do nothing;

  insert into public.catalog_product_shop_overrides(
    business_id, master_product_id, shop_id, canonical_product_id,
    price_minor, visible, manual_sold_out, version
  )
  select p_business_id, p.id, p_shop_id, p.id,
         p.price_minor, p.active, p.sold_out, 1
  from public.products p
  where p.shop_id = p_shop_id
    and not exists (
      select 1 from public.catalog_product_shop_overrides o
      where o.canonical_product_id = p.id
    )
  on conflict do nothing;

  update public.catalog_master_products mp
  set master_category_id = cb.master_category_id,
      canonical_name = p.name,
      description = p.description,
      image_key = p.image_key,
      archived_at = case when p.active then null else coalesce(mp.archived_at, now()) end,
      version = mp.version + case
        when mp.master_category_id is distinct from cb.master_category_id
          or mp.canonical_name is distinct from p.name
          or mp.description is distinct from p.description
          or mp.image_key is distinct from p.image_key
          or (mp.archived_at is null) = p.active
        then 1 else 0 end,
      updated_at = now()
  from public.catalog_product_shop_overrides o
  join public.products p on p.id = o.canonical_product_id and p.shop_id = o.shop_id
  join public.catalog_category_shop_bindings cb
    on cb.shop_id = p.shop_id and cb.canonical_category_id = p.category_id
  where o.business_id = p_business_id
    and o.shop_id = p_shop_id
    and mp.id = o.master_product_id
    and mp.business_id = o.business_id;

  update public.catalog_product_shop_overrides o
  set price_minor = p.price_minor,
      visible = p.active,
      manual_sold_out = p.sold_out,
      version = o.version + case
        when o.price_minor is distinct from p.price_minor
          or o.visible is distinct from p.active
          or o.manual_sold_out is distinct from p.sold_out
        then 1 else 0 end,
      updated_at = now()
  from public.products p
  where o.business_id = p_business_id
    and o.shop_id = p_shop_id
    and p.id = o.canonical_product_id
    and p.shop_id = o.shop_id;
end;
$$;

revoke all on function private.sync_admin_master_catalog_v1(uuid, uuid)
  from public, anon, authenticated;

-- Seed a lossless master/control-plane mapping without changing any canonical catalog UUID.
do $$
declare
  v_shop record;
begin
  for v_shop in
    select bs.business_id, bs.shop_id
    from public.business_shops bs
  loop
    perform private.sync_admin_master_catalog_v1(v_shop.business_id, v_shop.shop_id);
  end loop;
end $$;

-- Treat the newest pre-Admin Operations snapshot as the baseline live version for each shop.
insert into public.catalog_publish_versions(
  business_id,
  shop_id,
  publish_version,
  operations_configuration_version,
  source_kind,
  bundle_json,
  published_at
)
select bs.business_id,
       latest.shop_id,
       latest.version::bigint,
       latest.version,
       'BASELINE',
       latest.bundle_json,
       latest.published_at
from public.business_shops bs
join lateral (
  select s.shop_id, s.version, s.bundle_json, s.published_at
  from public.operations_configuration_snapshots s
  where s.shop_id = bs.shop_id
  order by s.version desc
  limit 1
) latest on true
on conflict (shop_id, publish_version) do nothing;

create or replace function public.create_catalog_draft_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_base_publish_version bigint default null,
  p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_publish_version bigint;
  v_operations_version integer;
  v_bundle jsonb;
  v_draft_id uuid;
begin
  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select coalesce(max(v.publish_version), 0)
    into v_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  if p_expected_base_publish_version is not null
     and p_expected_base_publish_version <> v_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_publish_version
    );
  end if;

  select coalesce(max(s.version), 0)
    into v_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  v_bundle := private.build_admin_catalog_bundle_v1(
    p_shop_id, v_operations_version, now()
  );

  insert into public.catalog_drafts(
    business_id, shop_id, created_by_employee_id, title,
    base_publish_version, working_bundle_json
  ) values (
    v_business_id, p_shop_id, p_employee_id, nullif(btrim(p_title), ''),
    v_publish_version, v_bundle
  )
  returning id into v_draft_id;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft_id,
    'draftRevision', 1,
    'basePublishVersion', v_publish_version,
    'bundleJson', v_bundle
  );
end;
$$;

create or replace function public.apply_catalog_draft_change_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_change_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_business_id uuid;
  v_next_bundle jsonb;
  v_new_revision bigint;
  v_pricing_changed boolean;
begin
  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_editable');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, v_draft.shop_id, 'catalog.edit'
  );
  if v_business_id <> v_draft.business_id then
    raise exception 'TUX_ADMIN_CATALOG_BUSINESS_MISMATCH';
  end if;

  if p_expected_draft_revision <> v_draft.draft_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_draft_revision',
      'currentDraftRevision', v_draft.draft_revision
    );
  end if;
  if jsonb_typeof(p_change_json) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_change');
  end if;

  v_next_bundle := case
    when p_change_json ? 'bundleJson' then p_change_json -> 'bundleJson'
    else p_change_json
  end;
  perform private.validate_admin_catalog_bundle_v1(v_draft.shop_id, v_next_bundle);

  select exists (
    select 1
    from jsonb_to_recordset(v_next_bundle -> 'snapshot' -> 'products') as next_product(
      id uuid, "priceMinor" bigint
    )
    left join jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'products') as previous_product(
      id uuid, "priceMinor" bigint
    ) on previous_product.id = next_product.id
    where previous_product.id is null
       or previous_product."priceMinor" is distinct from next_product."priceMinor"
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  v_new_revision := v_draft.draft_revision + 1;

  insert into public.catalog_draft_changes(
    business_id, draft_id, sequence, employee_id,
    expected_draft_revision, change_json, resulting_bundle_json
  ) values (
    v_draft.business_id, v_draft.id, v_new_revision - 1, p_employee_id,
    p_expected_draft_revision, p_change_json, v_next_bundle
  );

  update public.catalog_drafts
  set working_bundle_json = v_next_bundle,
      draft_revision = v_new_revision,
      updated_at = now()
  where id = v_draft.id;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'draftRevision', v_new_revision,
    'basePublishVersion', v_draft.base_publish_version
  );
end;
$$;

create or replace function public.publish_catalog_draft_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_draft public.catalog_drafts%rowtype;
  v_business_id uuid;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_pricing_changed boolean;
begin
  select * into v_draft
  from public.catalog_drafts d
  where d.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  if v_draft.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'draft_not_publishable');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, v_draft.shop_id, 'catalog.publish'
  );
  if v_business_id <> v_draft.business_id then
    raise exception 'TUX_ADMIN_CATALOG_BUSINESS_MISMATCH';
  end if;

  if p_expected_draft_revision <> v_draft.draft_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_draft_revision',
      'currentDraftRevision', v_draft.draft_revision
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || v_draft.shop_id::text, 0));

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = v_draft.shop_id;

  if p_expected_base_publish_version <> v_current_publish_version
     or v_draft.base_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  perform private.validate_admin_catalog_bundle_v1(
    v_draft.shop_id, v_draft.working_bundle_json
  );

  select exists (
    select 1
    from jsonb_to_recordset(v_draft.working_bundle_json -> 'snapshot' -> 'products') as next_product(
      id uuid, "priceMinor" bigint
    )
    left join public.products p
      on p.id = next_product.id and p.shop_id = v_draft.shop_id
    where p.id is null or p.price_minor is distinct from next_product."priceMinor"
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_draft.shop_id;

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    v_draft.shop_id,
    v_new_operations_version,
    now(),
    v_draft.working_bundle_json
  );

  -- Existing publisher materializes the canonical catalog/configuration rows and inserts the
  -- Operations snapshot. Because this is a nested function call, every write is in this same
  -- transaction and rolls back if any later validation/materialization step fails.
  perform public.publish_tux_operations_configuration(
    v_draft.shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );

  -- The original publisher predates these additive merchandising fields.
  perform private.materialize_admin_catalog_extended_fields_v1(v_draft.shop_id, v_bundle);
  perform private.sync_admin_master_catalog_v1(v_draft.business_id, v_draft.shop_id);

  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, draft_id, published_by_employee_id, bundle_json, published_at
  ) values (
    v_draft.business_id, v_draft.shop_id, v_new_publish_version, v_new_operations_version,
    'DRAFT', v_draft.id, p_employee_id, v_bundle, now()
  );

  update public.catalog_drafts
  set status = 'PUBLISHED',
      working_bundle_json = v_bundle,
      published_version = v_new_publish_version,
      published_at = now(),
      updated_at = now()
  where id = v_draft.id;

  return jsonb_build_object(
    'ok', true,
    'draftId', v_draft.id,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

create or replace function public.set_immediate_product_availability_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_product_id uuid,
  p_sold_out boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_current_sold_out boolean;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_products jsonb;
begin
  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );
  if p_sold_out is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select p.sold_out into v_current_sold_out
  from public.products p
  where p.id = p_product_id and p.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'product_not_found');
  end if;

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  if v_current_sold_out = p_sold_out then
    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'publishVersion', v_current_publish_version,
      'operationsConfigurationVersion', v_current_operations_version
    );
  end if;

  v_bundle := private.build_admin_catalog_bundle_v1(
    p_shop_id, v_current_operations_version, now()
  );

  select jsonb_agg(
    case
      when product ->> 'id' = p_product_id::text
        then jsonb_set(product, '{soldOut}', to_jsonb(p_sold_out), true)
      else product
    end
    order by ordinal
  )
  into v_products
  from jsonb_array_elements(v_bundle -> 'snapshot' -> 'products')
    with ordinality as source(product, ordinal);

  if v_products is null then
    return jsonb_build_object('ok', false, 'code', 'product_not_found');
  end if;
  v_bundle := jsonb_set(v_bundle, '{snapshot,products}', v_products, false);
  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_bundle);

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id, v_new_operations_version, now(), v_bundle
  );

  perform public.publish_tux_operations_configuration(
    p_shop_id, v_new_operations_version, v_bundle, null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);

  update public.products
  set sold_out_updated_at = now(),
      sold_out_by_worker_id = null
  where id = p_product_id and shop_id = p_shop_id;

  perform private.sync_admin_master_catalog_v1(v_business_id, p_shop_id);

  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, published_by_employee_id, bundle_json, published_at
  ) values (
    v_business_id, p_shop_id, v_new_publish_version, v_new_operations_version,
    'IMMEDIATE_AVAILABILITY', p_employee_id, v_bundle, now()
  );

  return jsonb_build_object(
    'ok', true,
    'productId', p_product_id,
    'soldOut', p_sold_out,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

revoke all on function public.create_catalog_draft_v1(uuid, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.set_immediate_product_availability_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.create_catalog_draft_v1(uuid, uuid, bigint, text) to service_role;
    grant execute on function public.apply_catalog_draft_change_v1(uuid, uuid, bigint, jsonb) to service_role;
    grant execute on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint) to service_role;
    grant execute on function public.set_immediate_product_availability_v1(uuid, uuid, uuid, boolean) to service_role;
  end if;
end $$;

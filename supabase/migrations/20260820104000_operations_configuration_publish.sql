-- Publish a complete validated Operations configuration bundle as one Postgres transaction.
-- Historical entity rows are retained for order FKs; entities absent from a newer bundle are
-- deactivated while relationship tables are replaced by the new complete snapshot.

create or replace function public.publish_tux_operations_configuration(
  p_shop_id uuid,
  p_version integer,
  p_bundle_json jsonb,
  p_published_by_auth_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_snapshot jsonb;
  v_updated_at timestamptz;
begin
  if p_shop_id is null or not exists (select 1 from public.shops where id = p_shop_id and active) then
    raise exception 'TUX_CONFIGURATION_SHOP_INVALID';
  end if;
  if p_version <= 0 then raise exception 'TUX_CONFIGURATION_VERSION_INVALID'; end if;
  if jsonb_typeof(p_bundle_json) <> 'object' then raise exception 'TUX_CONFIGURATION_BUNDLE_INVALID'; end if;

  v_snapshot := p_bundle_json -> 'snapshot';
  if jsonb_typeof(v_snapshot) <> 'object' then raise exception 'TUX_CONFIGURATION_SNAPSHOT_INVALID'; end if;
  if coalesce(v_snapshot ->> 'shopId', '') <> p_shop_id::text then
    raise exception 'TUX_CONFIGURATION_SHOP_MISMATCH';
  end if;
  if coalesce((v_snapshot ->> 'version')::integer, -1) <> p_version then
    raise exception 'TUX_CONFIGURATION_VERSION_MISMATCH';
  end if;
  v_updated_at := (v_snapshot ->> 'updatedAt')::timestamptz;

  if exists (
    select 1 from public.operations_configuration_snapshots
    where shop_id = p_shop_id and version >= p_version
  ) then
    raise exception 'TUX_CONFIGURATION_VERSION_NOT_MONOTONIC';
  end if;

  update public.menu_categories set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.products set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.modifiers set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.inventory_items set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.order_types set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.payment_methods set active = false, updated_at = v_updated_at where shop_id = p_shop_id;
  update public.delivery_zones set active = false, updated_at = v_updated_at where shop_id = p_shop_id;

  insert into public.menu_categories(id, shop_id, name, sort_order, active, updated_at)
  select x.id, x."shopId", x.name, x."sortOrder", x.active, v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'categories') as x(
    id uuid, "shopId" uuid, name text, "sortOrder" integer, active boolean
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    name = excluded.name,
    sort_order = excluded.sort_order,
    active = excluded.active,
    updated_at = excluded.updated_at;

  insert into public.products(
    id, shop_id, category_id, name, description, price_minor, image_key,
    active, sold_out, is_combo, sort_order, updated_at
  )
  select
    x.id, x."shopId", x."categoryId", x.name, x.description, x."priceMinor", x."imageKey",
    x.active, x."soldOut", x."isCombo", x."sortOrder", v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'products') as x(
    id uuid, "shopId" uuid, "categoryId" uuid, name text, description text,
    "priceMinor" bigint, "imageKey" text, active boolean, "soldOut" boolean,
    "isCombo" boolean, "sortOrder" integer
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    category_id = excluded.category_id,
    name = excluded.name,
    description = excluded.description,
    price_minor = excluded.price_minor,
    image_key = excluded.image_key,
    active = excluded.active,
    sold_out = excluded.sold_out,
    is_combo = excluded.is_combo,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

  insert into public.modifiers(
    id, shop_id, name, price_minor, standalone_product_id, active, sort_order, updated_at
  )
  select
    x.id, x."shopId", x.name, x."priceMinor", x."standaloneProductId",
    x.active, x."sortOrder", v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'modifiers') as x(
    id uuid, "shopId" uuid, name text, "priceMinor" bigint,
    "standaloneProductId" uuid, active boolean, "sortOrder" integer
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    name = excluded.name,
    price_minor = excluded.price_minor,
    standalone_product_id = excluded.standalone_product_id,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

  insert into public.inventory_items(
    id, shop_id, name, unit_label, tracking_mode, active, updated_at
  )
  select
    x.id, x."shopId", x.name, x."unitLabel", x."trackingMode", x.active, v_updated_at
  from jsonb_to_recordset(p_bundle_json -> 'inventoryItems') as x(
    id uuid, "shopId" uuid, name text, "unitLabel" text, "trackingMode" text, active boolean
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    name = excluded.name,
    unit_label = excluded.unit_label,
    tracking_mode = excluded.tracking_mode,
    active = excluded.active,
    updated_at = excluded.updated_at;

  insert into public.order_types(id, shop_id, name, behavior, active, sort_order, updated_at)
  select x.id, x."shopId", x.name, x.behavior, x.active, x."sortOrder", v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'orderTypes') as x(
    id uuid, "shopId" uuid, name text, behavior text, active boolean, "sortOrder" integer
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    name = excluded.name,
    behavior = excluded.behavior,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

  insert into public.payment_methods(
    id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order, updated_at
  )
  select
    x.id, x."shopId", x."displayName", x."logicType", x."requiresReconciliation",
    x.active, x."sortOrder", v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'paymentMethods') as x(
    id uuid, "shopId" uuid, "displayName" text, "logicType" text,
    "requiresReconciliation" boolean, active boolean, "sortOrder" integer
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    display_name = excluded.display_name,
    logic_type = excluded.logic_type,
    requires_reconciliation = excluded.requires_reconciliation,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

  insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order, updated_at)
  select x.id, x."shopId", x.name, x."feeMinor", x.active, x."sortOrder", v_updated_at
  from jsonb_to_recordset(v_snapshot -> 'deliveryZones') as x(
    id uuid, "shopId" uuid, name text, "feeMinor" bigint, active boolean, "sortOrder" integer
  )
  where x."shopId" = p_shop_id
  on conflict (id) do update set
    name = excluded.name,
    fee_minor = excluded.fee_minor,
    active = excluded.active,
    sort_order = excluded.sort_order,
    updated_at = excluded.updated_at;

  delete from public.product_modifiers where shop_id = p_shop_id;
  insert into public.product_modifiers(shop_id, product_id, modifier_id, max_quantity, sort_order)
  select x."shopId", x."productId", x."modifierId", x."maxQuantity", x."sortOrder"
  from jsonb_to_recordset(v_snapshot -> 'productModifierLinks') as x(
    "shopId" uuid, "productId" uuid, "modifierId" uuid, "maxQuantity" integer, "sortOrder" integer
  )
  where x."shopId" = p_shop_id;

  delete from public.combo_beverage_options where shop_id = p_shop_id;
  insert into public.combo_beverage_options(shop_id, combo_product_id, beverage_product_id, sort_order)
  select x."shopId", x."comboProductId", x."beverageProductId", x."sortOrder"
  from jsonb_to_recordset(v_snapshot -> 'comboBeverageOptions') as x(
    "shopId" uuid, "comboProductId" uuid, "beverageProductId" uuid, "sortOrder" integer
  )
  where x."shopId" = p_shop_id;

  delete from public.recipe_lines where shop_id = p_shop_id;
  insert into public.recipe_lines(shop_id, product_id, inventory_item_id, quantity_micros)
  select x."shopId", x."productId", x."inventoryItemId", x."quantityMicros"
  from jsonb_to_recordset(v_snapshot -> 'recipeLines') as x(
    "shopId" uuid, "productId" uuid, "inventoryItemId" uuid, "quantityMicros" bigint
  )
  where x."shopId" = p_shop_id;

  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values (p_shop_id, p_version, p_bundle_json, v_updated_at, p_published_by_auth_user_id);
end;
$$;

revoke all on function public.publish_tux_operations_configuration(uuid, integer, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_tux_operations_configuration(uuid, integer, jsonb, uuid)
  to service_role;

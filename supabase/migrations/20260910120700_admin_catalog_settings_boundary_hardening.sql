-- TUX Admin Plan 2 second Codex-review hardening.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- Catalog-owned publication must not mutate settings-owned canonical draft rows.

create or replace function private.publish_admin_catalog_configuration_v1(
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
  if p_shop_id is null or not exists (
    select 1 from public.shops where id = p_shop_id and active
  ) then
    raise exception 'TUX_CONFIGURATION_SHOP_INVALID';
  end if;
  if p_version <= 0 then raise exception 'TUX_CONFIGURATION_VERSION_INVALID'; end if;
  if jsonb_typeof(p_bundle_json) <> 'object' then
    raise exception 'TUX_CONFIGURATION_BUNDLE_INVALID';
  end if;

  v_snapshot := p_bundle_json -> 'snapshot';
  if jsonb_typeof(v_snapshot) <> 'object' then
    raise exception 'TUX_CONFIGURATION_SNAPSHOT_INVALID';
  end if;
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

  -- Only Catalog-owned canonical entities are materialized here. Inventory definitions,
  -- Order Types, Payment Methods, Delivery Zones, and Settings remain owned by their own
  -- workflows. The bundle still carries their latest published immutable representation.
  update public.menu_categories
  set active = false, updated_at = v_updated_at
  where shop_id = p_shop_id;
  update public.products
  set active = false, updated_at = v_updated_at
  where shop_id = p_shop_id;
  update public.modifiers
  set active = false, updated_at = v_updated_at
  where shop_id = p_shop_id;

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

revoke all on function private.publish_admin_catalog_configuration_v1(uuid, integer, jsonb, uuid)
  from public, anon, authenticated;

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

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = v_draft.shop_id;

  -- Protected sections are rebuilt from immutable published authority at execution time.
  -- Pending Settings row edits therefore remain pending in canonical rows and are neither
  -- published early nor overwritten by this Catalog publication.
  v_bundle := private.merge_catalog_owned_draft_bundle_v1(
    v_draft.shop_id,
    v_draft.working_bundle_json,
    v_current_operations_version,
    now()
  );

  select (
    exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'products') as next_product(
        id uuid, "priceMinor" bigint
      )
      left join public.products p
        on p.id = next_product.id and p.shop_id = v_draft.shop_id
      where p.id is null or p.price_minor is distinct from next_product."priceMinor"
    )
    or exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'modifiers') as next_modifier(
        id uuid, "priceMinor" bigint
      )
      left join public.modifiers m
        on m.id = next_modifier.id and m.shop_id = v_draft.shop_id
      where m.id is null or m.price_minor is distinct from next_modifier."priceMinor"
    )
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, v_draft.shop_id, 'catalog.pricing'
    );
  end if;

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    v_draft.shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );
  perform private.validate_admin_catalog_bundle_v1(v_draft.shop_id, v_bundle);

  perform private.publish_admin_catalog_configuration_v1(
    v_draft.shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
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

create or replace function public.restore_catalog_publish_version_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_source_publish_version bigint,
  p_expected_current_publish_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_business_id uuid;
  v_source public.catalog_publish_versions%rowtype;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_pricing_changed boolean;
begin
  if p_source_publish_version is null or p_source_publish_version < 1
     or p_expected_current_publish_version is null or p_expected_current_publish_version < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.publish'
  );

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;

  if p_expected_current_publish_version <> v_current_publish_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_version',
      'currentVersion', v_current_publish_version
    );
  end if;

  select * into v_source
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id
    and v.publish_version = p_source_publish_version;

  if not found or v_source.business_id <> v_business_id then
    return jsonb_build_object('ok', false, 'code', 'publish_version_not_found');
  end if;
  if p_source_publish_version >= v_current_publish_version then
    return jsonb_build_object('ok', false, 'code', 'restore_source_must_be_historical');
  end if;

  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  -- Replay only Catalog-owned history. Current inventory/settings/order/payment/delivery/reason
  -- authority is rebuilt from the latest trusted/published state.
  v_bundle := private.merge_catalog_owned_draft_bundle_v1(
    p_shop_id,
    v_source.bundle_json,
    v_current_operations_version,
    now()
  );

  select (
    exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'products') as source_product(
        id uuid, "priceMinor" bigint
      )
      left join public.products p
        on p.id = source_product.id and p.shop_id = p_shop_id
      where p.id is null or p.price_minor is distinct from source_product."priceMinor"
    )
    or exists (
      select 1
      from jsonb_to_recordset(v_bundle -> 'snapshot' -> 'modifiers') as source_modifier(
        id uuid, "priceMinor" bigint
      )
      left join public.modifiers m
        on m.id = source_modifier.id and m.shop_id = p_shop_id
      where m.id is null or m.price_minor is distinct from source_modifier."priceMinor"
    )
  ) into v_pricing_changed;

  if v_pricing_changed then
    perform private.assert_admin_catalog_permission_v1(
      p_employee_id, p_shop_id, 'catalog.pricing'
    );
  end if;

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );
  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_bundle);

  perform private.publish_admin_catalog_configuration_v1(
    p_shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);
  perform private.sync_admin_master_catalog_v1(v_business_id, p_shop_id);

  insert into public.catalog_publish_versions(
    business_id,
    shop_id,
    publish_version,
    operations_configuration_version,
    source_kind,
    published_by_employee_id,
    restored_from_publish_version,
    bundle_json,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_new_publish_version,
    v_new_operations_version,
    'ROLLBACK',
    p_employee_id,
    p_source_publish_version,
    v_bundle,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'sourcePublishVersion', p_source_publish_version,
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
    -- Equal effective state is still a meaningful human decision while a recurring rule may be
    -- forcing that same state. Update only this product's manual baseline; never mirror other
    -- recurrence-overridden live rows into their manual baselines.
    update public.catalog_product_shop_overrides o
    set manual_sold_out = p_sold_out,
        version = o.version + 1,
        updated_at = now()
    where o.business_id = v_business_id
      and o.shop_id = p_shop_id
      and o.canonical_product_id = p_product_id
      and o.manual_sold_out is distinct from p_sold_out;

    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'productId', p_product_id,
      'soldOut', p_sold_out,
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

  perform private.publish_admin_catalog_configuration_v1(
    p_shop_id, v_new_operations_version, v_bundle, null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);

  update public.products
  set sold_out_updated_at = now(),
      sold_out_by_worker_id = null
  where id = p_product_id and shop_id = p_shop_id;

  -- A direct human availability action owns this product's manual baseline. Update it directly
  -- so other products currently under recurring overrides are not accidentally captured.
  update public.catalog_product_shop_overrides o
  set price_minor = p.price_minor,
      visible = p.active,
      manual_sold_out = p_sold_out,
      version = o.version + case
        when o.price_minor is distinct from p.price_minor
          or o.visible is distinct from p.active
          or o.manual_sold_out is distinct from p_sold_out
        then 1 else 0 end,
      updated_at = now()
  from public.products p
  where o.business_id = v_business_id
    and o.shop_id = p_shop_id
    and o.canonical_product_id = p_product_id
    and p.id = o.canonical_product_id
    and p.shop_id = o.shop_id;

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

create or replace function public.apply_recurring_product_availability_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_rule_id uuid,
  p_rule_version bigint,
  p_transition text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule public.recurring_availability_rules%rowtype;
  v_business_id uuid;
  v_product_id uuid;
  v_manual_sold_out boolean;
  v_current_sold_out boolean;
  v_target_sold_out boolean;
  v_current_publish_version bigint;
  v_current_operations_version integer;
  v_new_publish_version bigint;
  v_new_operations_version integer;
  v_bundle jsonb;
  v_products jsonb;
begin
  if p_transition not in ('ENTER', 'EXIT') or p_rule_version is null or p_rule_version < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_rule
  from public.recurring_availability_rules r
  where r.id = p_rule_id
  for update;

  if not found or v_rule.shop_id <> p_shop_id then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  v_business_id := private.assert_admin_catalog_permission_v1(
    p_employee_id, p_shop_id, 'catalog.edit'
  );
  if v_business_id <> v_rule.business_id then
    raise exception 'TUX_ADMIN_RECURRING_AVAILABILITY_BUSINESS_MISMATCH';
  end if;

  if not v_rule.active or v_rule.version <> p_rule_version then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'obsolete_rule');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tux-admin-catalog:' || p_shop_id::text, 0));

  select o.canonical_product_id, o.manual_sold_out
    into v_product_id, v_manual_sold_out
  from public.catalog_product_shop_overrides o
  where o.business_id = v_business_id
    and o.shop_id = p_shop_id
    and o.master_product_id = v_rule.master_product_id
  for update;

  if v_product_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_mapping_missing');
  end if;

  select p.sold_out into v_current_sold_out
  from public.products p
  where p.id = v_product_id and p.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_target_sold_out := case
    when p_transition = 'ENTER' then not v_rule.available
    else v_manual_sold_out
  end;

  select coalesce(max(v.publish_version), 0)
    into v_current_publish_version
  from public.catalog_publish_versions v
  where v.shop_id = p_shop_id;
  select coalesce(max(s.version), 0)
    into v_current_operations_version
  from public.operations_configuration_snapshots s
  where s.shop_id = p_shop_id;

  if v_current_sold_out = v_target_sold_out then
    return jsonb_build_object(
      'ok', true,
      'idempotentReplay', true,
      'productId', v_product_id,
      'soldOut', v_target_sold_out,
      'publishVersion', v_current_publish_version,
      'operationsConfigurationVersion', v_current_operations_version
    );
  end if;

  v_bundle := private.build_admin_catalog_bundle_v1(
    p_shop_id, v_current_operations_version, now()
  );

  select jsonb_agg(
    case
      when product ->> 'id' = v_product_id::text
        then jsonb_set(product, '{soldOut}', to_jsonb(v_target_sold_out), true)
      else product
    end
    order by ordinal
  )
  into v_products
  from jsonb_array_elements(v_bundle -> 'snapshot' -> 'products')
    with ordinality as source(product, ordinal);

  if v_products is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'code', 'product_missing');
  end if;

  v_bundle := jsonb_set(v_bundle, '{snapshot,products}', v_products, false);
  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_bundle);

  v_new_operations_version := v_current_operations_version + 1;
  v_new_publish_version := v_current_publish_version + 1;
  v_bundle := private.normalize_admin_catalog_bundle_v1(
    p_shop_id,
    v_new_operations_version,
    now(),
    v_bundle
  );

  perform private.publish_admin_catalog_configuration_v1(
    p_shop_id,
    v_new_operations_version,
    v_bundle,
    null
  );
  perform private.materialize_admin_catalog_extended_fields_v1(p_shop_id, v_bundle);

  -- Recurring effective state must never replace the human-controlled manual_sold_out baseline.
  update public.products
  set sold_out_updated_at = now(),
      sold_out_by_worker_id = null
  where id = v_product_id and shop_id = p_shop_id;

  insert into public.catalog_publish_versions(
    business_id,
    shop_id,
    publish_version,
    operations_configuration_version,
    source_kind,
    published_by_employee_id,
    bundle_json,
    published_at
  ) values (
    v_business_id,
    p_shop_id,
    v_new_publish_version,
    v_new_operations_version,
    'RECURRING_AVAILABILITY',
    p_employee_id,
    v_bundle,
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'productId', v_product_id,
    'soldOut', v_target_sold_out,
    'publishVersion', v_new_publish_version,
    'operationsConfigurationVersion', v_new_operations_version
  );
end;
$$;

revoke all on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.restore_catalog_publish_version_v1(uuid, uuid, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.set_immediate_product_availability_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.publish_catalog_draft_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.restore_catalog_publish_version_v1(uuid, uuid, bigint, bigint)
      to service_role;
    grant execute on function public.set_immediate_product_availability_v1(uuid, uuid, uuid, boolean)
      to service_role;
    grant execute on function public.apply_recurring_product_availability_v1(uuid, uuid, uuid, bigint, text)
      to service_role;
  end if;
end $$;

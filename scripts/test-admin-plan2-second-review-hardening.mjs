import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910120700_admin_catalog_settings_boundary_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 second-review hardening migration is missing: ${migrationPath}`);
}
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'publish_admin_catalog_configuration_v1',
  'restore_catalog_publish_version_v1',
  'catalog.pricing',
  'manual_sold_out',
  'apply_recurring_product_availability_v1',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 second-review hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 second-review hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 second-review hardening refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '18000000-0000-4000-8000-000000000051';
const ownerId = '28000000-0000-4000-8000-000000000051';
const editorId = '28000000-0000-4000-8000-000000000052';
const categoryId = '38000000-0000-4000-8000-000000000051';
const productId = '48000000-0000-4000-8000-000000000051';
const modifierId = '58000000-0000-4000-8000-000000000051';
const inventoryId = '68000000-0000-4000-8000-000000000051';
const orderTypeId = '78000000-0000-4000-8000-000000000051';
const paymentMethodId = '88000000-0000-4000-8000-000000000051';
const zoneId = '98000000-0000-4000-8000-000000000051';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Plan 2 Second Review Fixture', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values
  ('${ownerId}', '${businessId}', 'Second Review Owner', 'OWNER', true),
  ('${editorId}', '${businessId}', 'Publisher Without Pricing', 'MANAGER', true);
insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
values ('${businessId}', '${editorId}', '${shopId}');
insert into public.admin_employee_permissions(business_id, employee_id, permission_key, effect)
values
  ('${businessId}', '${editorId}', 'catalog.edit', 'ALLOW'),
  ('${businessId}', '${editorId}', 'catalog.publish', 'ALLOW');

insert into public.menu_categories(id, shop_id, slug, name, description, sort_order, active)
values ('${categoryId}', '${shopId}', 'second-review-category', 'Second Review Category', null, 0, true);
insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'second-review-product', 'Second Review Product', null,
  1000, null, 'FIXTURE', false, true, false, false, 0
);
insert into public.modifiers(id, shop_id, name, price_minor, standalone_product_id, active, sort_order)
values ('${modifierId}', '${shopId}', 'Second Review Extra', 100, null, true, 0);
insert into public.inventory_items(id, shop_id, name, unit_label, tracking_mode, active)
values ('${inventoryId}', '${shopId}', 'Second Review Ingredient', 'g', 'RECIPE_TRACKED', true);
insert into public.recipe_lines(shop_id, product_id, inventory_item_id, quantity_micros)
values ('${shopId}', '${productId}', '${inventoryId}', 1000000);
insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
values ('${orderTypeId}', '${shopId}', 'Take Away', 'TAKE_AWAY', true, 0);
insert into public.payment_methods(
  id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order,
  channel, requires_reference, manual_confirmation_required, refund_allowed
) values (
  '${paymentMethodId}', '${shopId}', 'Cash', 'CASH', true, true, 0,
  'BOTH', false, false, true
);
insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order)
values ('${zoneId}', '${shopId}', 'Second Review Zone', 500, true, 0);

insert into public.business_setting_defaults(
  business_id, setting_key, value_json, version, updated_by_employee_id
) values ('${businessId}', 'checkout.minimumOrderMinor', '1000'::jsonb, 1, '${ownerId}');

do $$
declare
  v_result jsonb;
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_restore jsonb;
  v_draft_id uuid;
  v_bundle jsonb;
  v_latest jsonb;
  v_rule_id uuid;
  v_restore_denied boolean := false;
  v_name text;
  v_edit_version bigint;
  v_manual_sold_out boolean;
  v_live_sold_out boolean;
begin
  -- Publish settings v1 and create the first catalog draft from that effective authority.
  v_result := public.publish_shop_settings_v1('${ownerId}', '${shopId}', 0);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'settings v1 publish failed: %', v_result;
  end if;

  v_create := public.create_catalog_draft_v1('${ownerId}', '${shopId}', 0, 'Catalog v1');
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v1 draft creation failed: %', v_create;
  end if;
  v_draft_id := (v_create ->> 'draftId')::uuid;

  -- Settings row edits are intentionally unpublished. A catalog-only publish must not overwrite
  -- those pending canonical rows, while its Operations snapshot must still carry settings v1.
  v_result := public.update_admin_order_type_v1(
    '${ownerId}', '${shopId}', '${orderTypeId}', 'Pickup Pending', 'TAKE_AWAY', true, 0, 1, 1
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'pending order-type edit failed: %', v_result;
  end if;
  v_result := public.update_admin_payment_method_v1(
    '${ownerId}', '${shopId}', '${paymentMethodId}', 'Cash Pending', true, 0,
    'BOTH', false, false, true, 1, 1
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'pending payment-method edit failed: %', v_result;
  end if;

  v_publish := public.publish_catalog_draft_v1('${ownerId}', v_draft_id, 1, 0);
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v1 publish failed: %', v_publish;
  end if;

  select name, edit_version into v_name, v_edit_version
  from public.order_types where id = '${orderTypeId}';
  if v_name <> 'Pickup Pending' or v_edit_version <> 2 then
    raise exception 'catalog publish reverted pending order-type edit: %, v%', v_name, v_edit_version;
  end if;
  select display_name, edit_version into v_name, v_edit_version
  from public.payment_methods where id = '${paymentMethodId}';
  if v_name <> 'Cash Pending' or v_edit_version <> 2 then
    raise exception 'catalog publish reverted pending payment edit: %, v%', v_name, v_edit_version;
  end if;

  select s.bundle_json into v_latest
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' order by s.version desc limit 1;
  if v_latest #>> '{snapshot,settings,version}' <> '1'
     or v_latest #>> '{snapshot,orderTypes,0,name}' <> 'Take Away'
     or v_latest #>> '{snapshot,paymentMethods,0,displayName}' <> 'Cash' then
    raise exception 'catalog publish leaked unpublished settings into live snapshot: %', v_latest;
  end if;

  -- Publish the pending settings as v2. Later catalog history/restore must preserve this authority.
  v_result := public.publish_shop_settings_v1('${ownerId}', '${shopId}', 1);
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 2 then
    raise exception 'settings v2 publish failed: %', v_result;
  end if;

  -- Produce catalog v2 with a modifier-price change using the OWNER's pricing authority.
  v_create := public.create_catalog_draft_v1('${ownerId}', '${shopId}', 1, 'Catalog v2');
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v2 draft creation failed: %', v_create;
  end if;
  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';
  v_bundle := jsonb_set(v_bundle, '{snapshot,modifiers,0,priceMinor}', '250'::jsonb, false);
  v_apply := public.apply_catalog_draft_change_v1(
    '${ownerId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v2 modifier edit failed: %', v_apply;
  end if;
  v_publish := public.publish_catalog_draft_v1('${ownerId}', v_draft_id, 2, 1);
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v2 publish failed: %', v_publish;
  end if;

  -- A publisher without catalog.pricing cannot use restore to roll modifier prices back.
  begin
    perform public.restore_catalog_publish_version_v1('${editorId}', '${shopId}', 1, 2);
  exception when others then
    if sqlerrm like 'TUX_ADMIN_CATALOG_FORBIDDEN:%catalog.pricing%' then
      v_restore_denied := true;
    else
      raise;
    end if;
  end;
  if not v_restore_denied then
    raise exception 'catalog restore changed modifier pricing without catalog.pricing';
  end if;

  -- OWNER restore of catalog v1 must restore catalog-owned fields but keep settings v2 effective.
  v_restore := public.restore_catalog_publish_version_v1('${ownerId}', '${shopId}', 1, 2);
  if coalesce((v_restore ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog v1 restore failed: %', v_restore;
  end if;

  select s.bundle_json into v_latest
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}' order by s.version desc limit 1;
  if v_latest #>> '{snapshot,settings,version}' <> '2'
     or v_latest #>> '{snapshot,orderTypes,0,name}' <> 'Pickup Pending'
     or v_latest #>> '{snapshot,paymentMethods,0,displayName}' <> 'Cash Pending'
     or v_latest #>> '{snapshot,modifiers,0,priceMinor}' <> '100' then
    raise exception 'catalog restore replayed stale protected settings or missed catalog history: %', v_latest;
  end if;

  -- Recurring ENTER forces sold_out=true while the human baseline remains false.
  v_result := public.save_recurring_availability_rule_v1(
    '${ownerId}', '${shopId}', null, (
      select o.master_product_id
      from public.catalog_product_shop_overrides o
      where o.shop_id = '${shopId}' and o.canonical_product_id = '${productId}'
    ), array[0]::smallint[], '10:00'::time, '11:00'::time, false, true, null
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring rule creation failed: %', v_result;
  end if;
  v_rule_id := (v_result ->> 'ruleId')::uuid;

  v_result := public.apply_recurring_product_availability_v1(
    '${ownerId}', '${shopId}', v_rule_id, 1, 'ENTER'
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring ENTER failed: %', v_result;
  end if;

  -- The operator explicitly chooses sold_out=true while the recurring rule already makes live
  -- state true. This idempotent effective-state write must still update the human baseline.
  v_result := public.set_immediate_product_availability_v1(
    '${ownerId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'manual availability baseline update failed: %', v_result;
  end if;

  select o.manual_sold_out into v_manual_sold_out
  from public.catalog_product_shop_overrides o
  where o.shop_id = '${shopId}' and o.canonical_product_id = '${productId}';
  if v_manual_sold_out is not true then
    raise exception 'idempotent manual availability did not update manual_sold_out baseline';
  end if;

  v_result := public.apply_recurring_product_availability_v1(
    '${ownerId}', '${shopId}', v_rule_id, 1, 'EXIT'
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring EXIT failed: %', v_result;
  end if;
  select p.sold_out into v_live_sold_out from public.products p where p.id = '${productId}';
  if v_live_sold_out is not true then
    raise exception 'recurring EXIT reverted the operator manual sold_out=true baseline';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Plan 2 second-review hardening PostgreSQL behavior passed.');

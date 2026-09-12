import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910120400_admin_plan2_review_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 review hardening migration is missing: ${migrationPath}`);
}
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'merge_catalog_owned_draft_bundle_v1',
  'build_admin_catalog_bundle_v1',
  'catalog.pricing',
  'inventoryitems',
]) {
  if (!sql.includes(fragment)) throw new Error(`Plan 2 review hardening missing ${fragment}`);
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 review hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 review hardening behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '18000000-0000-4000-8000-000000000041';
const ownerId = '28000000-0000-4000-8000-000000000041';
const editorId = '28000000-0000-4000-8000-000000000042';
const categoryId = '38000000-0000-4000-8000-000000000041';
const productId = '48000000-0000-4000-8000-000000000041';
const modifierId = '58000000-0000-4000-8000-000000000041';
const inventoryId = '68000000-0000-4000-8000-000000000041';
const orderTypeId = '78000000-0000-4000-8000-000000000041';
const paymentMethodId = '88000000-0000-4000-8000-000000000041';
const zoneId = '98000000-0000-4000-8000-000000000041';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Plan 2 Review Fixture', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values
  ('${ownerId}', '${businessId}', 'Review Fixture Owner', 'OWNER', true),
  ('${editorId}', '${businessId}', 'Catalog Editor Without Pricing', 'MANAGER', true);
insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
values ('${businessId}', '${editorId}', '${shopId}');
insert into public.admin_employee_permissions(business_id, employee_id, permission_key, effect)
values
  ('${businessId}', '${editorId}', 'catalog.edit', 'ALLOW'),
  ('${businessId}', '${editorId}', 'catalog.publish', 'ALLOW');

insert into public.menu_categories(id, shop_id, slug, name, description, sort_order, active)
values ('${categoryId}', '${shopId}', 'review-category', 'Review Category', null, 0, true);
insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'review-product', 'Review Product', null,
  1000, null, 'FIXTURE', false, true, false, false, 0
);
insert into public.modifiers(id, shop_id, name, price_minor, standalone_product_id, active, sort_order)
values ('${modifierId}', '${shopId}', 'Review Extra', 100, null, true, 0);
insert into public.inventory_items(id, shop_id, name, unit_label, tracking_mode, active)
values ('${inventoryId}', '${shopId}', 'Review Ingredient', 'g', 'RECIPE_TRACKED', true);
insert into public.recipe_lines(shop_id, product_id, inventory_item_id, quantity_micros)
values ('${shopId}', '${productId}', '${inventoryId}', 1000000);
insert into public.order_types(id, shop_id, name, behavior, active, sort_order)
values ('${orderTypeId}', '${shopId}', 'Take Away', 'TAKE_AWAY', true, 0);
insert into public.payment_methods(id, shop_id, display_name, logic_type, requires_reconciliation, active, sort_order)
values ('${paymentMethodId}', '${shopId}', 'Cash', 'CASH', true, true, 0);
insert into public.delivery_zones(id, shop_id, name, fee_minor, active, sort_order)
values ('${zoneId}', '${shopId}', 'Review Zone', 500, true, 0);

insert into public.business_setting_defaults(
  business_id, setting_key, value_json, version, updated_by_employee_id
) values ('${businessId}', 'checkout.minimumOrderMinor', '1000'::jsonb, 1, '${ownerId}');

do $$
declare
  v_settings_publish jsonb;
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_draft_id uuid;
  v_bundle jsonb;
  v_saved jsonb;
  v_price_denied boolean := false;
begin
  v_settings_publish := public.publish_shop_settings_v1('${ownerId}', '${shopId}', 0);
  if coalesce((v_settings_publish ->> 'ok')::boolean, false) is not true then
    raise exception 'fixture settings publish failed: %', v_settings_publish;
  end if;

  v_create := public.create_catalog_draft_v1('${editorId}', '${shopId}', 0, 'Trust boundary draft');
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'fixture draft creation failed: %', v_create;
  end if;
  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';

  -- A catalog editor may submit a whole transport bundle, but protected domains must be
  -- reconstructed from trusted current authority before anything is persisted.
  v_bundle := jsonb_set(v_bundle, '{inventoryItems,0,name}', '"Hacked Ingredient"'::jsonb, false);
  v_bundle := jsonb_set(v_bundle, '{snapshot,orderTypes,0,name}', '"Hacked Order Type"'::jsonb, false);
  v_bundle := jsonb_set(v_bundle, '{snapshot,paymentMethods,0,displayName}', '"Hacked Payment"'::jsonb, false);
  v_bundle := jsonb_set(v_bundle, '{snapshot,deliveryZones,0,feeMinor}', '9999'::jsonb, false);
  v_bundle := jsonb_set(
    v_bundle,
    '{snapshot,settings,values,checkout.minimumOrderMinor}',
    '7777'::jsonb,
    false
  );

  v_apply := public.apply_catalog_draft_change_v1(
    '${editorId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true
     or (v_apply ->> 'draftRevision')::bigint <> 2 then
    raise exception 'protected-field draft save failed unexpectedly: %', v_apply;
  end if;

  select d.working_bundle_json into v_saved
  from public.catalog_drafts d where d.id = v_draft_id;
  if v_saved #>> '{inventoryItems,0,name}' <> 'Review Ingredient'
     or v_saved #>> '{snapshot,orderTypes,0,name}' <> 'Take Away'
     or v_saved #>> '{snapshot,paymentMethods,0,displayName}' <> 'Cash'
     or v_saved #>> '{snapshot,deliveryZones,0,feeMinor}' <> '500'
     or v_saved #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' <> '1000' then
    raise exception 'catalog draft persisted protected-domain mutation: %', v_saved;
  end if;

  -- Modifier pricing is catalog-owned but still requires catalog.pricing, just like product price.
  v_bundle := jsonb_set(v_saved, '{snapshot,modifiers,0,priceMinor}', '250'::jsonb, false);
  begin
    perform public.apply_catalog_draft_change_v1(
      '${editorId}', v_draft_id, 2, jsonb_build_object('bundleJson', v_bundle)
    );
  exception when others then
    if sqlerrm like 'TUX_ADMIN_CATALOG_FORBIDDEN:%' then
      v_price_denied := true;
    else
      raise;
    end if;
  end;
  if not v_price_denied then
    raise exception 'modifier price changed without catalog.pricing permission';
  end if;

  -- Advance published settings after the draft was created. Catalog publish must merge the
  -- latest immutable settings authority instead of replaying the draft's stale settings copy.
  update public.business_setting_defaults
  set value_json = '2000'::jsonb, version = version + 1, updated_at = now()
  where business_id = '${businessId}' and setting_key = 'checkout.minimumOrderMinor';
  v_settings_publish := public.publish_shop_settings_v1('${ownerId}', '${shopId}', 1);
  if coalesce((v_settings_publish ->> 'ok')::boolean, false) is not true
     or (v_settings_publish ->> 'settingsVersion')::bigint <> 2 then
    raise exception 'fixture second settings publish failed: %', v_settings_publish;
  end if;

  v_publish := public.publish_catalog_draft_v1('${editorId}', v_draft_id, 2, 0);
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog draft publish failed: %', v_publish;
  end if;

  select s.bundle_json into v_saved
  from public.operations_configuration_snapshots s
  where s.shop_id = '${shopId}'
  order by s.version desc
  limit 1;

  if v_saved #>> '{snapshot,settings,version}' <> '2'
     or v_saved #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' <> '2000'
     or v_saved #>> '{snapshot,orderTypes,0,name}' <> 'Take Away'
     or v_saved #>> '{snapshot,paymentMethods,0,displayName}' <> 'Cash'
     or v_saved #>> '{snapshot,deliveryZones,0,feeMinor}' <> '500'
     or v_saved #>> '{inventoryItems,0,name}' <> 'Review Ingredient' then
    raise exception 'catalog publish replayed stale/protected configuration: %', v_saved;
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

console.log('Plan 2 catalog draft review hardening PostgreSQL behavior passed.');

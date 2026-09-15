import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910121700_admin_plan2_final_codex_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 final Codex hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'publish_catalog_draft_scheduled_v1',
  "source_kind <> 'recurring_availability'",
  "'{soldout}'",
  'transition_priority',
  "payload_json ->> 'transition' = 'exit'",
  "payload_json ->> 'transition' = 'enter'",
  'update_admin_shop_operational_state_v1',
  'publish_shop_settings_v1',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 final Codex hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 final Codex hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 final Codex hardening behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000071';
const shopId = '19000000-0000-4000-8000-000000000071';
const employeeId = '29000000-0000-4000-8000-000000000071';
const categoryId = '39000000-0000-4000-8000-000000000071';
const productId = '49000000-0000-4000-8000-000000000071';
const draftId = '59000000-0000-4000-8000-000000000071';
const staleDraftId = '59000000-0000-4000-8000-000000000072';
const enterScheduleId = '69000000-0000-4000-8000-000000000001';
const exitScheduleId = '69000000-0000-4000-8000-000000000002';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name)
values ('${businessId}', 'Final Codex Fixture Business');

insert into public.shops(id, name, active)
values ('${shopId}', 'Final Codex Fixture Shop', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Final Codex Owner', 'OWNER', true);

insert into public.menu_categories(id, shop_id, name, sort_order, active, slug)
values ('${categoryId}', '${shopId}', 'Burgers', 10, true, 'burgers');

insert into public.products(
  id, shop_id, category_id, name, description, price_minor, image_key,
  active, sold_out, is_combo, sort_order, slug, best_seller
) values (
  '${productId}', '${shopId}', '${categoryId}', 'Live Burger', null, 15000, null,
  true, false, false, 10, 'live-burger', false
);

do $$
declare
  v_base jsonb;
  v_recurring jsonb;
  v_draft_bundle jsonb;
  v_current_bundle jsonb;
  v_result jsonb;
  v_published_bundle jsonb;
  v_settings_bundle jsonb;
  v_claim jsonb;
begin
  v_base := private.build_admin_catalog_bundle_v1('${shopId}', 1, '2026-09-15 09:00:00+00');

  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values ('${shopId}', 1, v_base, '2026-09-15 09:00:00+00', null);

  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, draft_id, published_by_employee_id, bundle_json, published_at
  ) values (
    '${businessId}', '${shopId}', 1, 1, 'BASELINE', null, '${employeeId}', v_base,
    '2026-09-15 09:00:00+00'
  );

  v_draft_bundle := jsonb_set(
    v_base,
    '{snapshot,products,0,name}',
    to_jsonb('Scheduled Burger'::text),
    false
  );

  insert into public.catalog_drafts(
    id, business_id, shop_id, created_by_employee_id, title, status,
    base_publish_version, draft_revision, working_bundle_json
  ) values (
    '${draftId}', '${businessId}', '${shopId}', '${employeeId}', 'Scheduled recurrence rebase',
    'DRAFT', 1, 1, v_draft_bundle
  );

  update public.products
  set sold_out = true, sold_out_updated_at = '2026-09-15 09:30:00+00'
  where id = '${productId}' and shop_id = '${shopId}';

  v_recurring := private.build_admin_catalog_bundle_v1(
    '${shopId}', 2, '2026-09-15 09:30:00+00'
  );
  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values ('${shopId}', 2, v_recurring, '2026-09-15 09:30:00+00', null);
  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, draft_id, published_by_employee_id, bundle_json, published_at
  ) values (
    '${businessId}', '${shopId}', 2, 2, 'RECURRING_AVAILABILITY', null, '${employeeId}',
    v_recurring, '2026-09-15 09:30:00+00'
  );

  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 1, 1
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'publishVersion')::bigint <> 3 then
    raise exception 'recurrence-only scheduled draft did not rebase and publish: %', v_result;
  end if;

  select published.bundle_json into v_published_bundle
  from public.catalog_publish_versions published
  where published.shop_id = '${shopId}' and published.publish_version = 3;

  if v_published_bundle #>> '{snapshot,products,0,name}' <> 'Scheduled Burger'
     or (v_published_bundle #>> '{snapshot,products,0,soldOut}')::boolean is not true then
    raise exception 'scheduled recurrence rebase dropped draft content or live soldOut: %', v_published_bundle;
  end if;

  select published.bundle_json into v_current_bundle
  from public.catalog_publish_versions published
  where published.shop_id = '${shopId}' and published.publish_version = 3;

  insert into public.catalog_drafts(
    id, business_id, shop_id, created_by_employee_id, title, status,
    base_publish_version, draft_revision, working_bundle_json
  ) values (
    '${staleDraftId}', '${businessId}', '${shopId}', '${employeeId}', 'Non-recurring stale fixture',
    'DRAFT', 3, 1, v_current_bundle
  );

  v_current_bundle := private.build_admin_catalog_bundle_v1(
    '${shopId}', 4, '2026-09-15 09:45:00+00'
  );
  insert into public.operations_configuration_snapshots(
    shop_id, version, bundle_json, published_at, published_by_auth_user_id
  ) values ('${shopId}', 4, v_current_bundle, '2026-09-15 09:45:00+00', null);
  insert into public.catalog_publish_versions(
    business_id, shop_id, publish_version, operations_configuration_version,
    source_kind, draft_id, published_by_employee_id, bundle_json, published_at
  ) values (
    '${businessId}', '${shopId}', 4, 4, 'IMMEDIATE_AVAILABILITY', null, '${employeeId}',
    v_current_bundle, '2026-09-15 09:45:00+00'
  );

  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${staleDraftId}', 1, 3
  );
  if v_result ->> 'code' <> 'stale_version'
     or (v_result ->> 'currentVersion')::bigint <> 4 then
    raise exception 'non-recurring catalog drift was incorrectly auto-rebased: %', v_result;
  end if;

  insert into public.scheduled_config_changes(
    id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
    timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
    idempotency_key, status, attempt_count
  ) values
    (
      '${enterScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
      jsonb_build_object('transition', 'ENTER', 'productId', '${productId}'),
      'Africa/Cairo', '2026-09-15 13:00:00', '2026-09-15 10:00:00+00', 4,
      'final-codex-enter', 'PENDING', 0
    ),
    (
      '${exitScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
      jsonb_build_object('transition', 'EXIT', 'productId', '${productId}'),
      'Africa/Cairo', '2026-09-15 13:00:00', '2026-09-15 10:00:00+00', 4,
      'final-codex-exit', 'PENDING', 0
    );

  select to_jsonb(claimed) into v_claim
  from public.claim_due_admin_config_changes_v1(
    '2026-09-15 10:00:00+00'::timestamptz, 1, 300
  ) claimed;
  if v_claim is null or v_claim #>> '{payload_json,transition}' <> 'EXIT' then
    raise exception 'same-time recurring EXIT was not claimed before ENTER: %', v_claim;
  end if;

  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', true, true, 0
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1
     or (v_result ->> 'operationsConfigurationVersion')::integer <> 5 then
    raise exception 'immediate operational-state publish failed: %', v_result;
  end if;

  if not exists (
    select 1 from public.shops shop
    where shop.id = '${shopId}'
      and shop.temporary_closed = true
      and shop.online_orders_paused = true
  ) then
    raise exception 'operational state did not update canonical shop flags';
  end if;

  select snapshot.bundle_json into v_settings_bundle
  from public.operations_configuration_snapshots snapshot
  where snapshot.shop_id = '${shopId}' and snapshot.version = 5;

  if (v_settings_bundle #>> '{snapshot,settings,shopIdentity,temporaryClosed}')::boolean is not true
     or (v_settings_bundle #>> '{snapshot,settings,shopIdentity,onlineOrdersPaused}')::boolean is not true then
    raise exception 'operational state was not immediately projected into published settings: %', v_settings_bundle;
  end if;

  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', false, false, 0
  );
  if v_result ->> 'code' <> 'stale_settings_version'
     or (v_result ->> 'currentVersion')::bigint <> 1 then
    raise exception 'operational-state stale settings CAS was not enforced: %', v_result;
  end if;

  if exists (
    select 1 from public.shops shop
    where shop.id = '${shopId}'
      and (shop.temporary_closed = false or shop.online_orders_paused = false)
  ) then
    raise exception 'stale operational-state command changed canonical flags';
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

console.log('Plan 2 final Codex hardening PostgreSQL behavior passed.');

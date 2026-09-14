import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910121200_admin_plan2_final_review_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 final review hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'validate_admin_catalog_changed_image_keys_v1',
  'catalog-product-images',
  'storage.objects',
  'publish_catalog_draft_scheduled_v1',
  "'replayed', true",
  'validate_admin_setting_value_v1',
]) {
  if (!sql.includes(fragment)) throw new Error(`Plan 2 final review hardening missing ${fragment}`);
}
if (sql.includes("'checkout.allowscheduledorders'")) {
  throw new Error('Plan 2 final review hardening must not retain unsupported scheduled-order setting authority.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 final review hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 final review hardening behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '19000000-0000-4000-8000-000000000041';
const employeeId = '29000000-0000-4000-8000-000000000041';
const draftId = '39000000-0000-4000-8000-000000000041';
const productId = '49000000-0000-4000-8000-000000000041';
const otherShopId = '19000000-0000-4000-8000-000000000099';
const validImageKey = `${shopId}/${productId}.png`;
const missingImageKey = `${shopId}/49000000-0000-4000-8000-000000000042.png`;
const crossShopImageKey = `${otherShopId}/${productId}.png`;

const behaviorSql = String.raw`
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);

begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Plan 2 Final Review Fixture', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Final Review Scheduler', 'OWNER', true);

insert into public.catalog_drafts(
  id, business_id, shop_id, created_by_employee_id, title, status,
  base_publish_version, draft_revision, working_bundle_json,
  published_version, published_at
) values (
  '${draftId}', '${businessId}', '${shopId}', '${employeeId}', 'Replay fixture', 'PUBLISHED',
  48, 3, '{}'::jsonb, 49, now()
);
insert into public.catalog_publish_versions(
  business_id, shop_id, publish_version, operations_configuration_version,
  source_kind, draft_id, published_by_employee_id, bundle_json, published_at
) values (
  '${businessId}', '${shopId}', 49, 77,
  'DRAFT', '${draftId}', '${employeeId}', '{}'::jsonb, now()
);

insert into storage.objects(bucket_id, name)
values ('catalog-product-images', '${validImageKey}');

do $$
declare
  v_result jsonb;
  v_cross_shop_rejected boolean := false;
  v_missing_rejected boolean := false;
  v_bundle jsonb;
begin
  if private.validate_admin_setting_value_v1('checkout.allowScheduledOrders', 'true'::jsonb) then
    raise exception 'unsupported scheduled-order setting remains writable through trusted SQL';
  end if;
  if not private.validate_admin_setting_value_v1('checkout.allowDiscountStacking', 'true'::jsonb)
     or not private.validate_admin_setting_value_v1('checkout.allowDeliveryFeeOverride', 'false'::jsonb) then
    raise exception 'supported checkout boolean settings were accidentally removed';
  end if;

  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 3, 48
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or coalesce((v_result ->> 'replayed')::boolean, false) is not true
     or (v_result ->> 'publishVersion')::bigint <> 49
     or (v_result ->> 'operationsConfigurationVersion')::integer <> 77 then
    raise exception 'scheduled publish replay was not reconciled: %', v_result;
  end if;

  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 2, 48
  );
  if v_result ->> 'code' <> 'stale_draft_revision' then
    raise exception 'scheduled replay ignored draft revision fence: %', v_result;
  end if;

  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 3, 47
  );
  if v_result ->> 'code' <> 'stale_version' then
    raise exception 'scheduled replay ignored base publish fence: %', v_result;
  end if;

  v_bundle := jsonb_build_object(
    'snapshot', jsonb_build_object(
      'products', jsonb_build_array(
        jsonb_build_object('id', '${productId}', 'imageKey', '${validImageKey}')
      )
    )
  );
  perform private.validate_admin_catalog_changed_image_keys_v1('${shopId}', v_bundle);

  v_bundle := jsonb_set(
    v_bundle,
    '{snapshot,products,0,imageKey}',
    to_jsonb('${crossShopImageKey}'::text),
    false
  );
  begin
    perform private.validate_admin_catalog_changed_image_keys_v1('${shopId}', v_bundle);
  exception when others then
    if sqlerrm = 'TUX_ADMIN_CATALOG_IMAGE_KEY_FORBIDDEN' then
      v_cross_shop_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_cross_shop_rejected then
    raise exception 'cross-shop image key was accepted';
  end if;

  v_bundle := jsonb_set(
    v_bundle,
    '{snapshot,products,0,imageKey}',
    to_jsonb('${missingImageKey}'::text),
    false
  );
  begin
    perform private.validate_admin_catalog_changed_image_keys_v1('${shopId}', v_bundle);
  exception when others then
    if sqlerrm = 'TUX_ADMIN_CATALOG_IMAGE_OBJECT_MISSING' then
      v_missing_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_missing_rejected then
    raise exception 'missing image object was accepted';
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

console.log('Plan 2 final review hardening PostgreSQL behavior passed.');

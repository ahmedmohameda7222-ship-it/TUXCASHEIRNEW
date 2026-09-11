import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910112000_admin_catalog_publish_controls.sql';
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const name of [
  'restored_from_publish_version',
  'schedule_catalog_draft_v1',
  'cancel_scheduled_config_change_v1',
  'restore_catalog_publish_version_v1',
  'africa/cairo',
]) {
  if (!sql.includes(name)) {
    throw new Error(`admin catalog publish controls migration missing ${name}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin catalog publish controls static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin catalog publish controls behavioral test refuses non-loopback PostgreSQL.');
}

const shopId = '17000000-0000-4000-8000-000000000001';
const employeeId = '27000000-0000-4000-8000-000000000001';
const categoryId = '37000000-0000-4000-8000-000000000001';
const productId = '47000000-0000-4000-8000-000000000001';
const businessId = '00000000-0000-4000-8000-000000000001';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Admin Catalog Publish Fixture', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Catalog Publish Fixture Owner', 'OWNER', true);

insert into public.menu_categories(
  id, shop_id, slug, name, description, sort_order, active
) values (
  '${categoryId}', '${shopId}', 'publish-burgers', 'Publish Burgers',
  'Publish fixture category', 0, true
);

insert into public.products(
  id, shop_id, category_id, slug, name, description, price_minor, image_key,
  family, best_seller, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'publish-burger', 'Publish Burger',
  'Publish fixture product', 1000, null, 'FIXTURE', false, true, false, false, 0
);

do $$
declare
  v_create jsonb;
  v_apply jsonb;
  v_publish jsonb;
  v_immediate jsonb;
  v_restore jsonb;
  v_stale_restore jsonb;
  v_schedule jsonb;
  v_schedule_replay jsonb;
  v_cancel jsonb;
  v_cancel_replay jsonb;
  v_draft_id uuid;
  v_schedule_id uuid;
  v_bundle jsonb;
  v_version_one_snapshot jsonb;
  v_version_one_snapshot_after jsonb;
  v_count integer;
begin
  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 0, 'Publish controls base'
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'publish-controls draft creation failed: %', v_create;
  end if;

  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,priceMinor}',
    '1500'::jsonb,
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'publish-controls draft update failed: %', v_apply;
  end if;

  v_publish := public.publish_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 0
  );
  if coalesce((v_publish ->> 'ok')::boolean, false) is not true
     or (v_publish ->> 'publishVersion')::bigint <> 1 then
    raise exception 'publish-controls initial publish failed: %', v_publish;
  end if;

  select v.bundle_json into v_version_one_snapshot
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.publish_version = 1;

  v_immediate := public.set_immediate_product_availability_v1(
    '${employeeId}', '${shopId}', '${productId}', true
  );
  if coalesce((v_immediate ->> 'ok')::boolean, false) is not true
     or (v_immediate ->> 'publishVersion')::bigint <> 2 then
    raise exception 'publish-controls immediate availability failed: %', v_immediate;
  end if;

  v_restore := public.restore_catalog_publish_version_v1(
    '${employeeId}', '${shopId}', 1, 2
  );
  if coalesce((v_restore ->> 'ok')::boolean, false) is not true
     or (v_restore ->> 'sourcePublishVersion')::bigint <> 1
     or (v_restore ->> 'publishVersion')::bigint <> 3
     or (v_restore ->> 'operationsConfigurationVersion')::integer <> 3 then
    raise exception 'catalog restore-as-new-version failed: %', v_restore;
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = '${productId}'
      and p.shop_id = '${shopId}'
      and p.price_minor = 1500
      and p.sold_out = false
  ) then
    raise exception 'restore did not materialize historical content as current canonical state';
  end if;

  if not exists (
    select 1 from public.catalog_publish_versions v
    where v.shop_id = '${shopId}'
      and v.publish_version = 3
      and v.source_kind = 'ROLLBACK'
      and v.restored_from_publish_version = 1
  ) then
    raise exception 'restore did not append rollback lineage';
  end if;

  select v.bundle_json into v_version_one_snapshot_after
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}' and v.publish_version = 1;
  if v_version_one_snapshot_after is distinct from v_version_one_snapshot then
    raise exception 'restore rewrote historical publish content';
  end if;

  v_stale_restore := public.restore_catalog_publish_version_v1(
    '${employeeId}', '${shopId}', 1, 2
  );
  if v_stale_restore ->> 'code' <> 'stale_version'
     or (v_stale_restore ->> 'currentVersion')::bigint <> 3 then
    raise exception 'stale restore was not fenced: %', v_stale_restore;
  end if;

  select count(*) into v_count
  from public.catalog_publish_versions v
  where v.shop_id = '${shopId}';
  if v_count <> 3 then
    raise exception 'stale restore unexpectedly appended history';
  end if;

  v_create := public.create_catalog_draft_v1(
    '${employeeId}', '${shopId}', 3, 'Future scheduled price'
  );
  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := jsonb_set(
    v_create -> 'bundleJson',
    '{snapshot,products,0,priceMinor}',
    '1750'::jsonb,
    false
  );
  v_apply := public.apply_catalog_draft_change_v1(
    '${employeeId}', v_draft_id, 1, jsonb_build_object('bundleJson', v_bundle)
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'scheduled draft update failed: %', v_apply;
  end if;

  v_schedule := public.schedule_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 3, timestamp '2099-09-11 08:00:00'
  );
  if coalesce((v_schedule ->> 'ok')::boolean, false) is not true then
    raise exception 'catalog schedule creation failed: %', v_schedule;
  end if;
  v_schedule_id := (v_schedule ->> 'scheduleId')::uuid;

  if not exists (
    select 1 from public.scheduled_config_changes s
    where s.id = v_schedule_id
      and s.shop_id = '${shopId}'
      and s.change_kind = 'CATALOG_PUBLISH'
      and s.status = 'PENDING'
      and s.timezone = 'Africa/Cairo'
      and s.local_scheduled_at = timestamp '2099-09-11 08:00:00'
      and s.scheduled_for = timestamp '2099-09-11 08:00:00' at time zone 'Africa/Cairo'
      and s.target_base_publish_version = 3
      and s.payload_json ->> 'draftId' = v_draft_id::text
      and (s.payload_json ->> 'expectedDraftRevision')::bigint = 2
  ) then
    raise exception 'catalog schedule did not persist Cairo/version-safe execution intent';
  end if;

  v_schedule_replay := public.schedule_catalog_draft_v1(
    '${employeeId}', v_draft_id, 2, 3, timestamp '2099-09-11 08:00:00'
  );
  if coalesce((v_schedule_replay ->> 'ok')::boolean, false) is not true
     or coalesce((v_schedule_replay ->> 'idempotentReplay')::boolean, false) is not true
     or (v_schedule_replay ->> 'scheduleId')::uuid <> v_schedule_id then
    raise exception 'catalog schedule replay was not idempotent: %', v_schedule_replay;
  end if;

  select count(*) into v_count
  from public.scheduled_config_changes s
  where s.shop_id = '${shopId}' and s.change_kind = 'CATALOG_PUBLISH';
  if v_count <> 1 then
    raise exception 'catalog schedule replay duplicated durable work';
  end if;

  v_cancel := public.cancel_scheduled_config_change_v1(
    '${employeeId}', '${shopId}', v_schedule_id
  );
  if coalesce((v_cancel ->> 'ok')::boolean, false) is not true
     or v_cancel ->> 'status' <> 'CANCELLED' then
    raise exception 'catalog schedule cancellation failed: %', v_cancel;
  end if;

  v_cancel_replay := public.cancel_scheduled_config_change_v1(
    '${employeeId}', '${shopId}', v_schedule_id
  );
  if coalesce((v_cancel_replay ->> 'ok')::boolean, false) is not true
     or coalesce((v_cancel_replay ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'catalog schedule cancellation replay failed: %', v_cancel_replay;
  end if;
end $$;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.schedule_catalog_draft_v1(uuid,uuid,bigint,bigint,timestamp without time zone)',
    'public.cancel_scheduled_config_change_v1(uuid,uuid,uuid)',
    'public.restore_catalog_publish_version_v1(uuid,uuid,bigint,bigint)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'Admin publish-control RPC % leaked browser EXECUTE privilege', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Admin publish-control RPC % missing service_role EXECUTE privilege', v_function;
    end if;
  end loop;
end $$;

rollback;
`;

const result = spawnSync(
  'psql',
  [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', behaviorSql],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  throw new Error(`Admin catalog publish controls behavioral test failed with exit code ${result.status}.`);
}

console.log('Admin catalog publish controls static and PostgreSQL behavioral invariants passed.');

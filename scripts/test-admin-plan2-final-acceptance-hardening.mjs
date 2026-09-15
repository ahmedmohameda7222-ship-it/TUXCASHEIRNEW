import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910122000_admin_plan2_final_acceptance_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 final acceptance migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  "'recurring_availability', 'immediate_availability'",
  'predecessor.scheduled_for <= s.scheduled_for',
  'v_business_id := v_rule.business_id',
  'resume_catalog_draft_v1',
  'update_admin_shop_identity_v1',
  'upsert_admin_shop_weekly_hours_v1',
  'upsert_admin_shop_special_hours_v1',
  'refund_policy_not_editable_until_enforced',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 final acceptance hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 final acceptance hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 final acceptance behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000122';
const shopId = '12000000-0000-4000-8000-000000000122';
const employeeId = '22000000-0000-4000-8000-000000000122';
const categoryId = '32000000-0000-4000-8000-000000000122';
const productId = '42000000-0000-4000-8000-000000000122';
const draftId = '52000000-0000-4000-8000-000000000122';
const exitScheduleId = '62000000-0000-4000-8000-000000000122';
const enterScheduleId = '62000000-0000-4000-8000-000000000123';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name, timezone, currency_code)
values ('${businessId}', 'Plan 2 Final Acceptance Fixture', 'Africa/Cairo', 'EGP');

insert into public.shops(id, name, active)
values ('${shopId}', 'Acceptance Shop', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Acceptance Owner', 'OWNER', true);

insert into public.menu_categories(id, shop_id, slug, name, sort_order, active)
values ('${categoryId}', '${shopId}', 'acceptance', 'Acceptance', 0, true);
insert into public.products(
  id, shop_id, category_id, slug, name, price_minor, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'acceptance-product', 'Acceptance Product',
  1200, true, false, false, 0
);
select private.sync_admin_master_catalog_v1('${businessId}', '${shopId}');

-- Materialize an authorized recurring rule while the creator is active, then prove execution
-- survives creator deactivation because the durable scheduler/service boundary owns execution.
do $$
declare
  v_master_product_id uuid;
  v_create jsonb;
  v_apply jsonb;
  v_rule_id uuid;
begin
  select o.master_product_id into v_master_product_id
  from public.catalog_product_shop_overrides o
  where o.shop_id = '${shopId}' and o.canonical_product_id = '${productId}';
  if v_master_product_id is null then
    raise exception 'final acceptance fixture missing master product mapping';
  end if;

  v_create := public.save_recurring_availability_rule_v1(
    '${employeeId}', '${shopId}', null, v_master_product_id,
    array[2]::smallint[], time '10:00', time '11:00', false, true, null
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true then
    raise exception 'final acceptance recurring rule creation failed: %', v_create;
  end if;
  v_rule_id := (v_create ->> 'ruleId')::uuid;

  update public.business_employees set active = false where id = '${employeeId}';
  v_apply := public.apply_recurring_product_availability_v1(
    '${employeeId}', '${shopId}', v_rule_id, 1, 'ENTER'
  );
  if coalesce((v_apply ->> 'ok')::boolean, false) is not true then
    raise exception 'inactive creator blocked scheduler-authority recurrence: %', v_apply;
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = '${productId}' and p.shop_id = '${shopId}' and p.sold_out = true
  ) then
    raise exception 'scheduler-authority recurrence did not update canonical availability';
  end if;
  if not exists (
    select 1 from public.catalog_publish_versions v
    where v.shop_id = '${shopId}'
      and v.source_kind = 'RECURRING_AVAILABILITY'
      and v.published_by_employee_id = '${employeeId}'
  ) then
    raise exception 'scheduler recurrence lost creator audit attribution';
  end if;

  update public.business_employees set active = true where id = '${employeeId}';
end $$;

-- Persisted DRAFT bundles resume only on the exact live base and remain browser-inaccessible.
insert into public.catalog_drafts(
  id, business_id, shop_id, created_by_employee_id, title, status,
  base_publish_version, draft_revision, working_bundle_json
)
select
  '${draftId}', '${businessId}', '${shopId}', '${employeeId}', 'Persisted acceptance draft', 'DRAFT',
  max(v.publish_version), 3,
  jsonb_build_object('snapshot', jsonb_build_object('products', '[]'::jsonb))
from public.catalog_publish_versions v
where v.shop_id = '${shopId}';

do $$
declare
  v_current bigint;
  v_resume jsonb;
  v_stale jsonb;
begin
  select max(v.publish_version) into v_current
  from public.catalog_publish_versions v where v.shop_id = '${shopId}';

  v_resume := public.resume_catalog_draft_v1('${employeeId}', '${shopId}', '${draftId}', v_current);
  if coalesce((v_resume ->> 'ok')::boolean, false) is not true
     or (v_resume ->> 'draftRevision')::bigint <> 3
     or (v_resume ->> 'basePublishVersion')::bigint <> v_current then
    raise exception 'persisted catalog draft did not resume: %', v_resume;
  end if;

  v_stale := public.resume_catalog_draft_v1('${employeeId}', '${shopId}', '${draftId}', v_current - 1);
  if v_stale ->> 'code' <> 'stale_version'
     or (v_stale ->> 'currentVersion')::bigint <> v_current then
    raise exception 'persisted draft resume ignored live-version fence: %', v_stale;
  end if;
end $$;

-- A delayed earlier EXIT remains a dependency even while it is in retry backoff.
do $$
declare
  v_master_product_id uuid;
begin
  select o.master_product_id into v_master_product_id
  from public.catalog_product_shop_overrides o
  where o.shop_id = '${shopId}' and o.canonical_product_id = '${productId}';

  insert into public.scheduled_config_changes(
    id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
    timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
    idempotency_key, status, attempt_count, terminal_failure, next_attempt_at
  ) values
  (
    '${exitScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
    jsonb_build_object('transition', 'EXIT', 'masterProductId', v_master_product_id),
    'Africa/Cairo', timestamp '2026-09-15 10:00:00', timestamptz '2026-09-15 07:00:00+00', null,
    'acceptance-exit', 'FAILED', 1, false, timestamptz '2026-09-15 08:30:00+00'
  ),
  (
    '${enterScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
    jsonb_build_object('transition', 'ENTER', 'masterProductId', v_master_product_id),
    'Africa/Cairo', timestamp '2026-09-15 10:05:00', timestamptz '2026-09-15 07:05:00+00', null,
    'acceptance-enter', 'PENDING', 0, false, null
  );
end $$;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.claim_due_admin_config_changes_v1(timestamptz '2026-09-15 07:10:00+00', 10, 300) x
  where x.id = '${enterScheduleId}';
  if v_count <> 0 then
    raise exception 'later ENTER bypassed earlier unresolved EXIT';
  end if;

  update public.scheduled_config_changes
  set status = 'CANCELLED', next_attempt_at = null, updated_at = now()
  where id = '${exitScheduleId}';

  select count(*) into v_count
  from public.claim_due_admin_config_changes_v1(timestamptz '2026-09-15 07:10:00+00', 10, 300) x
  where x.id = '${enterScheduleId}';
  if v_count <> 1 then
    raise exception 'ENTER remained blocked after predecessor EXIT cancellation';
  end if;
end $$;

-- Identity and hours are staged canonical settings inputs with both publication-version and row CAS.
do $$
declare
  v_identity jsonb;
  v_weekly jsonb;
  v_weekly_stale jsonb;
  v_special jsonb;
  v_special_remove jsonb;
  v_weekly_id uuid;
  v_special_id uuid;
begin
  v_identity := public.update_admin_shop_identity_v1(
    '${employeeId}', '${shopId}', 'Acceptance Shop Updated', '1 Test Street', '+201000000122',
    30.0444, 31.2357, 0,
    'Acceptance Shop', null, null, null, null
  );
  if coalesce((v_identity ->> 'ok')::boolean, false) is not true then
    raise exception 'shop identity update failed: %', v_identity;
  end if;

  v_identity := public.update_admin_shop_identity_v1(
    '${employeeId}', '${shopId}', 'Stale Identity', null, null, null, null, 0,
    'Acceptance Shop', null, null, null, null
  );
  if v_identity ->> 'code' <> 'stale_identity' then
    raise exception 'shop identity row CAS did not reject stale values: %', v_identity;
  end if;

  v_identity := public.update_admin_shop_identity_v1(
    '${employeeId}', '${shopId}', 'Wrong Version', '1 Test Street', '+201000000122',
    30.0444, 31.2357, 99,
    'Acceptance Shop Updated', '1 Test Street', '+201000000122', 30.0444, 31.2357
  );
  if v_identity ->> 'code' <> 'stale_settings_version'
     or (v_identity ->> 'currentVersion')::bigint <> 0 then
    raise exception 'shop identity ignored settings publication fence: %', v_identity;
  end if;

  v_weekly := public.upsert_admin_shop_weekly_hours_v1(
    '${employeeId}', '${shopId}', null, 'ONLINE', 2, time '09:00', time '22:00', true, 0, null
  );
  if coalesce((v_weekly ->> 'ok')::boolean, false) is not true then
    raise exception 'weekly hours create failed: %', v_weekly;
  end if;
  v_weekly_id := (v_weekly ->> 'hoursId')::uuid;

  v_weekly_stale := public.upsert_admin_shop_weekly_hours_v1(
    '${employeeId}', '${shopId}', v_weekly_id, 'ONLINE', 2, time '10:00', time '22:00', true, 0,
    jsonb_build_object(
      'serviceKind', 'ONLINE', 'dayOfWeek', 2,
      'opensLocal', '08:00:00', 'closesLocal', '22:00:00', 'active', true
    )
  );
  if v_weekly_stale ->> 'code' <> 'stale_hours_row' then
    raise exception 'weekly hours row CAS did not reject stale values: %', v_weekly_stale;
  end if;

  v_weekly := public.upsert_admin_shop_weekly_hours_v1(
    '${employeeId}', '${shopId}', v_weekly_id, 'ONLINE', 2, time '10:00', time '22:00', true, 0,
    jsonb_build_object(
      'serviceKind', 'ONLINE', 'dayOfWeek', 2,
      'opensLocal', '09:00:00', 'closesLocal', '22:00:00', 'active', true
    )
  );
  if coalesce((v_weekly ->> 'ok')::boolean, false) is not true then
    raise exception 'weekly hours valid CAS update failed: %', v_weekly;
  end if;

  v_special := public.upsert_admin_shop_special_hours_v1(
    '${employeeId}', '${shopId}', null, date '2026-12-31', 'ONLINE', true,
    null, null, 'Year end', true, 0, null
  );
  if coalesce((v_special ->> 'ok')::boolean, false) is not true then
    raise exception 'special hours create failed: %', v_special;
  end if;
  v_special_id := (v_special ->> 'hoursId')::uuid;

  v_special_remove := public.upsert_admin_shop_special_hours_v1(
    '${employeeId}', '${shopId}', v_special_id, date '2026-12-31', 'ONLINE', true,
    null, null, 'Year end', false, 0,
    jsonb_build_object(
      'serviceDate', '2026-12-31', 'serviceKind', 'ONLINE', 'closed', true,
      'opensLocal', null, 'closesLocal', null, 'note', 'Year end'
    )
  );
  if coalesce((v_special_remove ->> 'ok')::boolean, false) is not true
     or coalesce((v_special_remove ->> 'deactivated')::boolean, false) is not true
     or exists (select 1 from public.shop_special_hours h where h.id = v_special_id) then
    raise exception 'special hours deactivation failed: %', v_special_remove;
  end if;
end $$;

-- New trusted RPCs must remain BFF/service-role only.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'resume_catalog_draft_v1(uuid,uuid,uuid,bigint)',
    'update_admin_shop_identity_v1(uuid,uuid,text,text,text,numeric,numeric,bigint,text,text,text,numeric,numeric)',
    'upsert_admin_shop_weekly_hours_v1(uuid,uuid,uuid,text,smallint,time without time zone,time without time zone,boolean,bigint,jsonb)',
    'upsert_admin_shop_special_hours_v1(uuid,uuid,uuid,date,text,boolean,time without time zone,time without time zone,text,boolean,bigint,jsonb)'
  ] loop
    if has_function_privilege('anon', 'public.' || v_function, 'EXECUTE')
       or has_function_privilege('authenticated', 'public.' || v_function, 'EXECUTE') then
      raise exception 'final acceptance RPC % leaked browser EXECUTE privilege', v_function;
    end if;
    if not has_function_privilege('service_role', 'public.' || v_function, 'EXECUTE') then
      raise exception 'final acceptance RPC % missing service_role EXECUTE privilege', v_function;
    end if;
  end loop;
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

console.log('Plan 2 final acceptance hardening PostgreSQL behavior passed.');

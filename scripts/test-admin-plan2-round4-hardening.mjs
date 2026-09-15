import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910121700_admin_plan2_final_codex_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Plan 2 round 4 hardening migration is missing: ${migrationPath}`);
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'publish_catalog_draft_scheduled_v1',
  "source_kind <> 'recurring_availability'",
  "'{soldout}'",
  'base_publish_version = v_current_publish_version',
  'claim_due_admin_config_changes_v1',
  'transition_priority',
  "payload_json ->> 'transition' = 'exit'",
  "payload_json ->> 'transition' = 'enter'",
  'update_admin_shop_operational_state_v1',
  'publish_shop_settings_v1',
  "'settings.manage'",
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Plan 2 round 4 hardening missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Plan 2 round 4 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 4 behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000074';
const shopId = '17000000-0000-4000-8000-000000000074';
const employeeId = '27000000-0000-4000-8000-000000000074';
const categoryId = '37000000-0000-4000-8000-000000000074';
const productId = '47000000-0000-4000-8000-000000000074';
const draftId = '57000000-0000-4000-8000-000000000074';
const exitScheduleId = '67000000-0000-4000-8000-000000000074';
const enterScheduleId = '67000000-0000-4000-8000-000000000075';

const behaviorSql = String.raw`
begin;

insert into public.businesses(id, name)
values ('${businessId}', 'Plan 2 Round 4 Fixture Business');

insert into public.shops(id, name, active)
values ('${shopId}', 'Plan 2 Round 4 Fixture Shop', true);

insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');

insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Plan 2 Round 4 Owner', 'OWNER', true);

insert into public.menu_categories(id, shop_id, name, sort_order, active)
values ('${categoryId}', '${shopId}', 'Round 4 Category', 10, true);

insert into public.products(
  id, shop_id, category_id, name, price_minor, active, sold_out, is_combo, sort_order
) values (
  '${productId}', '${shopId}', '${categoryId}', 'Round 4 Product', 1000, true, true, false, 10
);

insert into public.catalog_drafts(
  id, business_id, shop_id, created_by_employee_id, title, status,
  base_publish_version, draft_revision, working_bundle_json
) values (
  '${draftId}', '${businessId}', '${shopId}', '${employeeId}', 'Round 4 recurring rebase', 'DRAFT',
  1, 1,
  jsonb_build_object(
    'snapshot', jsonb_build_object(
      'products', jsonb_build_array(
        jsonb_build_object('id', '${productId}', 'soldOut', false)
      )
    )
  )
);

insert into public.catalog_publish_versions(
  business_id, shop_id, publish_version, operations_configuration_version,
  source_kind, bundle_json, published_at
) values
  ('${businessId}', '${shopId}', 1, 1, 'BASELINE', '{}'::jsonb, now()),
  ('${businessId}', '${shopId}', 2, 2, 'RECURRING_AVAILABILITY', '{}'::jsonb, now());

create temp table round4_catalog_publish_calls(
  expected_base bigint not null,
  observed_base bigint not null,
  observed_sold_out boolean not null
) on commit drop;

create or replace function public.publish_catalog_draft_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint
)
returns jsonb
language plpgsql
as $stub$
declare
  v_base bigint;
  v_sold_out boolean;
begin
  select
    d.base_publish_version,
    (d.working_bundle_json #>> '{snapshot,products,0,soldOut}')::boolean
  into v_base, v_sold_out
  from public.catalog_drafts d
  where d.id = p_draft_id;

  insert into pg_temp.round4_catalog_publish_calls(expected_base, observed_base, observed_sold_out)
  values (p_expected_base_publish_version, v_base, v_sold_out);

  return jsonb_build_object(
    'ok', true,
    'draftId', p_draft_id,
    'publishVersion', p_expected_base_publish_version + 1,
    'operationsConfigurationVersion', 99
  );
end;
$stub$;

do $$
declare
  v_result jsonb;
  v_base bigint;
  v_sold_out boolean;
  v_call_count integer;
begin
  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 1, 1
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'recurring-only scheduled rebase did not publish: %', v_result;
  end if;

  select
    d.base_publish_version,
    (d.working_bundle_json #>> '{snapshot,products,0,soldOut}')::boolean
  into v_base, v_sold_out
  from public.catalog_drafts d
  where d.id = '${draftId}';

  if v_base <> 2 or v_sold_out is not true then
    raise exception 'scheduled rebase did not preserve live soldOut/base: base %, soldOut %',
      v_base, v_sold_out;
  end if;

  select count(*) into v_call_count
  from pg_temp.round4_catalog_publish_calls c
  where c.expected_base = 2
    and c.observed_base = 2
    and c.observed_sold_out = true;
  if v_call_count <> 1 then
    raise exception 'strict publish did not receive the rebased recurring-only draft';
  end if;
end $$;

insert into public.catalog_publish_versions(
  business_id, shop_id, publish_version, operations_configuration_version,
  source_kind, bundle_json, published_at
) values (
  '${businessId}', '${shopId}', 3, 3, 'IMMEDIATE_AVAILABILITY', '{}'::jsonb, now()
);

do $$
declare
  v_result jsonb;
  v_call_count integer;
begin
  v_result := public.publish_catalog_draft_scheduled_v1(
    '${employeeId}', '${draftId}', 1, 2
  );
  if v_result ->> 'code' <> 'stale_version'
     or (v_result ->> 'currentVersion')::bigint <> 3 then
    raise exception 'non-recurring intervening version was not rejected: %', v_result;
  end if;

  select count(*) into v_call_count from pg_temp.round4_catalog_publish_calls;
  if v_call_count <> 1 then
    raise exception 'strict publish ran despite non-recurring stale version';
  end if;
end $$;

insert into public.scheduled_config_changes(
  id, business_id, shop_id, created_by_employee_id, change_kind, payload_json,
  timezone, local_scheduled_at, scheduled_for, target_base_publish_version,
  idempotency_key, status, attempt_count
) values
(
  '${enterScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
  jsonb_build_object('transition', 'ENTER', 'productId', '${productId}'),
  'Africa/Cairo',
  ('2026-09-15 00:00:00+00'::timestamptz at time zone 'Africa/Cairo'),
  '2026-09-15 00:00:00+00'::timestamptz, 3,
  'round4-enter', 'PENDING', 0
),
(
  '${exitScheduleId}', '${businessId}', '${shopId}', '${employeeId}', 'PRODUCT_AVAILABILITY',
  jsonb_build_object('transition', 'EXIT', 'productId', '${productId}'),
  'Africa/Cairo',
  ('2026-09-15 00:00:00+00'::timestamptz at time zone 'Africa/Cairo'),
  '2026-09-15 00:00:00+00'::timestamptz, 3,
  'round4-exit', 'PENDING', 0
);

do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_due_admin_config_changes_v1(
    '2026-09-15 00:00:01+00'::timestamptz,
    1,
    300
  );

  if v_claim.id is distinct from '${exitScheduleId}'::uuid
     or v_claim.payload_json ->> 'transition' <> 'EXIT' then
    raise exception 'same-time recurring scheduler did not claim EXIT first: %', row_to_json(v_claim);
  end if;
end $$;

-- Round 5 security contract: emergency toggles publish from the latest immutable
-- Operations bundle and must not route through mutable staged Admin settings.
insert into public.operations_configuration_snapshots(
  shop_id, version, bundle_json, published_at, published_by_auth_user_id
) values (
  '${shopId}', 7,
  jsonb_build_object(
    'snapshot', jsonb_build_object(
      'shopId', '${shopId}',
      'version', 7,
      'updatedAt', '2026-09-14T23:00:00.000Z',
      'settings', jsonb_build_object(
        'version', 44,
        'values', jsonb_build_object('checkout.minimumOrderMinor', 111),
        'shopIdentity', jsonb_build_object(
          'publishedSentinel', 'keep-me',
          'temporaryClosed', false,
          'onlineOrdersPaused', false
        ),
        'weeklyHours', '[]'::jsonb,
        'specialHours', '[]'::jsonb,
        'paymentMethodZoneRules', '[]'::jsonb
      )
    )
  ),
  '2026-09-14 23:00:00+00'::timestamptz,
  null
);

insert into public.shop_setting_overrides(
  business_id, shop_id, setting_key, value_json, version, updated_by_employee_id
) values (
  '${businessId}', '${shopId}', 'checkout.minimumOrderMinor', '9999'::jsonb, 1, '${employeeId}'
);

-- Keep a hostile replacement in place: the emergency path must not call this function at all.
create or replace function public.publish_shop_settings_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_settings_version bigint
)
returns jsonb
language plpgsql
as $stub$
begin
  raise exception 'ROUND5_EMERGENCY_MUST_NOT_CALL_SETTINGS_PUBLISH';
end;
$stub$;

do $$
declare
  v_result jsonb;
  v_closed boolean;
  v_paused boolean;
  v_published_value text;
  v_published_sentinel text;
  v_snapshot_version integer;
begin
  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', true, true, 0
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true
     or (v_result ->> 'settingsVersion')::bigint <> 1
     or (v_result ->> 'operationsConfigurationVersion')::integer <> 8 then
    raise exception 'operational-state immutable publish failed: %', v_result;
  end if;

  select s.temporary_closed, s.online_orders_paused
    into v_closed, v_paused
  from public.shops s
  where s.id = '${shopId}';
  if v_closed is not true or v_paused is not true then
    raise exception 'operational-state flags were not updated';
  end if;

  select
    version.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}',
    version.bundle_json #>> '{snapshot,settings,shopIdentity,publishedSentinel}'
  into v_published_value, v_published_sentinel
  from public.shop_settings_versions version
  where version.shop_id = '${shopId}'
    and version.settings_version = 1;

  if v_published_value is distinct from '111'
     or v_published_sentinel is distinct from 'keep-me' then
    raise exception 'emergency publish leaked staged settings or lost published state: value %, sentinel %',
      v_published_value, v_published_sentinel;
  end if;

  select snapshot.version,
         snapshot.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}',
         snapshot.bundle_json #>> '{snapshot,settings,shopIdentity,publishedSentinel}'
    into v_snapshot_version, v_published_value, v_published_sentinel
  from public.operations_configuration_snapshots snapshot
  where snapshot.shop_id = '${shopId}'
  order by snapshot.version desc
  limit 1;

  if v_snapshot_version <> 8
     or v_published_value is distinct from '111'
     or v_published_sentinel is distinct from 'keep-me' then
    raise exception 'Operations snapshot did not preserve immutable published settings';
  end if;

  if exists (
    select 1
    from public.shop_settings_versions version
    where version.shop_id = '${shopId}'
      and version.settings_version = 1
      and version.bundle_json #>> '{snapshot,settings,values,checkout.minimumOrderMinor}' = '9999'
  ) then
    raise exception 'staged settings override leaked into emergency publish';
  end if;

  v_result := public.update_admin_shop_operational_state_v1(
    '${employeeId}', '${shopId}', false, false, 0
  );
  if v_result ->> 'code' <> 'stale_settings_version'
     or (v_result ->> 'currentVersion')::bigint <> 1 then
    raise exception 'operational-state CAS did not reject stale version: %', v_result;
  end if;

  select s.temporary_closed, s.online_orders_paused
    into v_closed, v_paused
  from public.shops s
  where s.id = '${shopId}';
  if v_closed is not true or v_paused is not true then
    raise exception 'stale operational-state command mutated canonical flags';
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

console.log('Plan 2 round 4 hardening PostgreSQL behavior passed.');

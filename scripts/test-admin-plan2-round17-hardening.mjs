import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath =
  'supabase/migrations/20260910123300_admin_plan2_final_review_round17_hardening.sql';
const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Plan 2 round 17 hardening migration is missing: ${migrationPath}`);
  }
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
  for (const fragment of [
    'catalog_public_service_kind_open_v1',
    "'open'",
    "'delivery'",
    'fulfillmentpreferences',
    'catalog_public_online_ordering_open_v1',
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(`Plan 2 round 17 hardening missing ${fragment}`);
    }
  }
  console.log('Plan 2 round 17 hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Plan 2 round 17 behavioral test refuses non-loopback PostgreSQL.');
}

const shopId = '17000000-0000-4000-8000-000000000170';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Plan 2 Round 17 Shop', true);

insert into public.operations_configuration_snapshots(
  shop_id, version, bundle_json, published_at, published_by_auth_user_id
) values (
  '${shopId}',
  1,
  jsonb_build_object(
    'snapshot', jsonb_build_object(
      'shopId', '${shopId}',
      'version', 1,
      'settings', jsonb_build_object(
        'version', 1,
        'values', jsonb_build_object(
          'checkout.minimumOrderMinor', 0,
          'checkout.serviceChargeBps', 0,
          'checkout.taxBps', 0,
          'checkout.allowDiscountStacking', false,
          'checkout.requireCustomerPhone', false
        ),
        'shopIdentity', jsonb_build_object(
          'shopId', '${shopId}',
          'displayName', 'Round 17 Shop',
          'timezone', 'Africa/Cairo',
          'lifecycleState', 'ACTIVE',
          'temporaryClosed', false,
          'onlineOrdersPaused', false
        ),
        'weeklyHours', '[]'::jsonb,
        'specialHours', jsonb_build_array(
          jsonb_build_object(
            'serviceDate', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
            'serviceKind', 'DELIVERY',
            'timezone', 'Africa/Cairo',
            'closed', true,
            'opensLocal', null,
            'closesLocal', null
          )
        )
      ),
      'orderTypes', jsonb_build_array(
        jsonb_build_object(
          'id', '27000000-0000-4000-8000-000000000170',
          'active', true,
          'behavior', 'TAKE_AWAY'
        ),
        jsonb_build_object(
          'id', '37000000-0000-4000-8000-000000000170',
          'active', true,
          'behavior', 'DELIVERY'
        )
      ),
      'paymentMethods', jsonb_build_array(
        jsonb_build_object(
          'id', '47000000-0000-4000-8000-000000000170',
          'displayName', 'Cash',
          'logicType', 'CASH',
          'active', true,
          'channel', 'BOTH',
          'integrationReference', null
        )
      )
    )
  ),
  now(),
  null
);

do $$
declare
  v_result jsonb;
  v_bundle jsonb;
begin
  -- ONLINE and OPEN have no configured hours, so rollout-compatible semantics keep them open.
  -- DELIVERY has an explicit same-date closure and must therefore be omitted from customer choices.
  v_result := public.read_catalog_public_ordering_v2('${shopId}');
  if (v_result #>> '{ordering,available}')::boolean is not true then
    raise exception 'round 17 fixture unexpectedly closed global ONLINE ordering: %', v_result;
  end if;
  if v_result #> '{ordering,fulfillmentPreferences}' <> '["PICKUP"]'::jsonb then
    raise exception 'round 17 DELIVERY closure was still advertised: %', v_result;
  end if;

  select bundle_json into v_bundle
  from public.operations_configuration_snapshots
  where shop_id = '${shopId}' and version = 1;

  -- Swap the explicit closure to OPEN. Delivery has no configured hours and therefore remains
  -- rollout-open, while Pickup must disappear from the projection.
  update public.operations_configuration_snapshots
  set bundle_json = jsonb_set(
    v_bundle,
    '{snapshot,settings,specialHours}',
    jsonb_build_array(
      jsonb_build_object(
        'serviceDate', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
        'serviceKind', 'OPEN',
        'timezone', 'Africa/Cairo',
        'closed', true,
        'opensLocal', null,
        'closesLocal', null
      )
    ),
    true
  )
  where shop_id = '${shopId}' and version = 1;

  v_result := public.read_catalog_public_ordering_v2('${shopId}');
  if v_result #> '{ordering,fulfillmentPreferences}' <> '["DELIVERY"]'::jsonb then
    raise exception 'round 17 OPEN closure was still advertised for Pickup: %', v_result;
  end if;

  -- No OPEN/DELIVERY hours configured must preserve rollout compatibility for active order types.
  update public.operations_configuration_snapshots
  set bundle_json = jsonb_set(
    bundle_json,
    '{snapshot,settings,specialHours}',
    '[]'::jsonb,
    true
  )
  where shop_id = '${shopId}' and version = 1;

  v_result := public.read_catalog_public_ordering_v2('${shopId}');
  if v_result #> '{ordering,fulfillmentPreferences}' <> '["PICKUP","DELIVERY"]'::jsonb then
    raise exception 'round 17 no-hours rollout compatibility regressed: %', v_result;
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q'], {
  input: behaviorSql,
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  process.exit(1);
}

console.log('Plan 2 round 17 fulfillment projection behavior passed.');

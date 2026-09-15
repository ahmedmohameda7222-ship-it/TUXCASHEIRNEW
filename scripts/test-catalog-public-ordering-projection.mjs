import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const baseMigrationPath = 'supabase/migrations/20260910120200_catalog_public_settings_projection.sql';
const checkoutPolicyMigrationPath =
  'supabase/migrations/20260910121100_catalog_public_checkout_policy_projection.sql';
const onlineHoursMigrationPath =
  'supabase/migrations/20260910121600_catalog_public_online_hours_projection.sql';
for (const [path, label] of [
  [baseMigrationPath, 'catalog public settings projection'],
  [checkoutPolicyMigrationPath, 'catalog public checkout policy projection'],
  [onlineHoursMigrationPath, 'catalog public online hours projection'],
]) {
  if (!fs.existsSync(path)) throw new Error(`${label} migration is missing`);
}

const sql = [baseMigrationPath, checkoutPolicyMigrationPath, onlineHoursMigrationPath]
  .map((path) => fs.readFileSync(path, 'utf8').toLowerCase())
  .join('\n');
for (const fragment of [
  'read_catalog_public_ordering_v2',
  'security definer',
  'operations_configuration_snapshots',
  'order by',
  'version desc',
  'limit 1',
  'checkout.servicechargebps',
  'checkout.taxbps',
  'checkout.allowdiscountstacking',
  'checkout.requirecustomerphone',
  'catalog_public_online_ordering_open_v1',
  'africa/cairo',
  'weeklyhours',
  'specialhours',
  'servicekind',
  'grant execute',
  'anon',
  'authenticated',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`catalog public checkout projection migration missing ${fragment}`);
  }
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Catalog public ordering projection static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Catalog public ordering projection test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '18000000-0000-4000-8000-000000000001';
const noSnapshotShopId = '18000000-0000-4000-8000-000000000002';
const malformedShopId = '18000000-0000-4000-8000-000000000003';
const rolloutShopId = '18000000-0000-4000-8000-000000000004';
const rolloutEmployeeId = '28000000-0000-4000-8000-000000000004';

const firstBundle = {
  snapshot: {
    shopId,
    version: 1,
    settings: {
      version: 1,
      values: { 'checkout.minimumOrderMinor': 3000 },
      shopIdentity: {
        shopId,
        displayName: 'Old TUX Maadi',
        address: 'Old address',
        phone: '+201000000001',
        latitude: 29.95,
        longitude: 31.25,
        timezone: 'Africa/Cairo',
        lifecycleState: 'ACTIVE',
        temporaryClosed: false,
        onlineOrdersPaused: false,
      },
    },
    orderTypes: [],
    paymentMethods: [],
  },
};

const latestBundle = {
  snapshot: {
    shopId,
    version: 2,
    settings: {
      version: 2,
      values: {
        'checkout.minimumOrderMinor': 4500,
        'checkout.serviceChargeBps': 500,
        'checkout.taxBps': 1400,
        'checkout.allowDiscountStacking': true,
        'checkout.requireCustomerPhone': true,
      },
      shopIdentity: {
        shopId,
        displayName: 'TUX Maadi',
        address: 'Road 9, Maadi',
        phone: '+201000000000',
        latitude: 29.9602,
        longitude: 31.2569,
        timezone: 'Africa/Cairo',
        lifecycleState: 'ACTIVE',
        temporaryClosed: false,
        onlineOrdersPaused: false,
      },
    },
    orderTypes: [
      { id: '28000000-0000-4000-8000-000000000001', active: true, behavior: 'TAKE_AWAY' },
      { id: '28000000-0000-4000-8000-000000000002', active: true, behavior: 'DELIVERY' },
      { id: '28000000-0000-4000-8000-000000000003', active: true, behavior: 'DINE_IN' },
    ],
    paymentMethods: [
      {
        id: '38000000-0000-4000-8000-000000000001',
        displayName: 'Cash',
        logicType: 'CASH',
        active: true,
        channel: 'BOTH',
        integrationReference: null,
      },
      {
        id: '38000000-0000-4000-8000-000000000002',
        displayName: 'InstaPay',
        logicType: 'DIGITAL',
        active: true,
        channel: 'ONLINE',
        integrationReference: 'INSTAPAY',
      },
      {
        id: '38000000-0000-4000-8000-000000000003',
        displayName: 'Card terminal',
        logicType: 'CARD',
        active: true,
        channel: 'POS',
        integrationReference: 'provider-secret-name',
      },
    ],
  },
};

const malformedBundle = {
  snapshot: {
    ...latestBundle.snapshot,
    shopId: malformedShopId,
    settings: {
      ...latestBundle.snapshot.settings,
      shopIdentity: { ...latestBundle.snapshot.settings.shopIdentity, shopId: malformedShopId },
      values: {
        ...latestBundle.snapshot.settings.values,
        'checkout.serviceChargeBps': '500',
      },
    },
  },
};

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values
  ('${shopId}', 'Public ordering fixture', true),
  ('${noSnapshotShopId}', 'No published ordering fixture', true),
  ('${malformedShopId}', 'Malformed published ordering fixture', true),
  ('${rolloutShopId}', 'Rollout Emergency Shop', true);
update public.shops
set address_text = '12 Rollout Street',
    contact_phone = '+201099999999',
    latitude = 30.044400,
    longitude = 31.235700
where id = '${rolloutShopId}';
insert into public.business_shops(business_id, shop_id)
values
  ('${businessId}', '${shopId}'),
  ('${businessId}', '${noSnapshotShopId}'),
  ('${businessId}', '${malformedShopId}'),
  ('${businessId}', '${rolloutShopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${rolloutEmployeeId}', '${businessId}', 'Rollout Emergency Owner', 'OWNER', true);

insert into public.operations_configuration_snapshots(
  shop_id, version, bundle_json, published_at, published_by_auth_user_id
) values
  ('${shopId}', 1, ${quote(JSON.stringify(firstBundle))}::jsonb, now() - interval '1 minute', null),
  ('${shopId}', 2, ${quote(JSON.stringify(latestBundle))}::jsonb, now(), null),
  ('${malformedShopId}', 1, ${quote(JSON.stringify(malformedBundle))}::jsonb, now(), null),
  (
    '${rolloutShopId}',
    1,
    private.build_admin_catalog_core_bundle_v1(
      '${rolloutShopId}',
      1,
      '2026-09-15 12:00:00+00'::timestamptz
    ),
    '2026-09-15 12:00:00+00'::timestamptz,
    null
  );

do $$
declare
  v_result jsonb;
  v_missing jsonb;
  v_malformed jsonb;
  v_hours_settings jsonb;
  v_emergency_result jsonb;
  v_emergency_identity jsonb;
  v_emergency_projection jsonb;
begin
  v_result := public.read_catalog_public_ordering_v2('${shopId}');
  if v_result is null then
    raise exception 'public ordering projection unexpectedly returned null';
  end if;

  if v_result - 'shop' - 'ordering' <> '{}'::jsonb then
    raise exception 'public ordering projection leaked top-level fields: %', v_result;
  end if;
  if (v_result -> 'shop') - 'displayName' - 'address' - 'phone' - 'latitude' - 'longitude' <> '{}'::jsonb then
    raise exception 'public shop projection leaked internal identity fields: %', v_result -> 'shop';
  end if;
  if (v_result -> 'ordering')
       - 'available'
       - 'temporaryClosed'
       - 'onlineOrdersPaused'
       - 'minimumOrderMinor'
       - 'serviceChargeBps'
       - 'taxBps'
       - 'allowDiscountStacking'
       - 'requireCustomerPhone'
       - 'fulfillmentPreferences'
       - 'paymentPreferences' <> '{}'::jsonb then
    raise exception 'public ordering projection leaked internal policy fields: %', v_result -> 'ordering';
  end if;

  if v_result #>> '{shop,displayName}' <> 'TUX Maadi'
     or v_result #>> '{shop,address}' <> 'Road 9, Maadi'
     or (v_result #>> '{ordering,minimumOrderMinor}')::bigint <> 4500
     or (v_result #>> '{ordering,serviceChargeBps}')::bigint <> 500
     or (v_result #>> '{ordering,taxBps}')::bigint <> 1400
     or (v_result #>> '{ordering,allowDiscountStacking}')::boolean is not true
     or (v_result #>> '{ordering,requireCustomerPhone}')::boolean is not true
     or (v_result #>> '{ordering,available}')::boolean is not true then
    raise exception 'latest immutable published checkout policy was not projected: %', v_result;
  end if;

  if v_result #> '{ordering,fulfillmentPreferences}' <> '["PICKUP","DELIVERY"]'::jsonb then
    raise exception 'public fulfillment projection is incorrect: %', v_result;
  end if;
  if v_result #> '{ordering,paymentPreferences}' <> '["CASH","INSTAPAY","MIXED"]'::jsonb then
    raise exception 'public payment projection is incorrect: %', v_result;
  end if;

  if v_result::text like '%integrationReference%'
     or v_result::text like '%provider-secret-name%'
     or v_result::text like '%lifecycleState%'
     or v_result::text like '%bundle_json%' then
    raise exception 'public ordering projection leaked internal published configuration: %', v_result;
  end if;

  v_hours_settings := jsonb_build_object(
    'weeklyHours', jsonb_build_array(
      jsonb_build_object(
        'serviceKind', 'ONLINE', 'dayOfWeek', 1, 'timezone', 'Africa/Cairo',
        'opensLocal', '12:00', 'closesLocal', '13:00', 'active', true
      ),
      jsonb_build_object(
        'serviceKind', 'ONLINE', 'dayOfWeek', 1, 'timezone', 'Africa/Cairo',
        'opensLocal', '22:00', 'closesLocal', '02:00', 'active', true
      )
    ),
    'specialHours', '[]'::jsonb
  );
  if private.catalog_public_online_ordering_open_v1(
       v_hours_settings, timestamptz '2026-01-05 10:30:00+00'
     ) is not true then
    raise exception 'Cairo weekly ONLINE interval was not opened';
  end if;
  if private.catalog_public_online_ordering_open_v1(
       v_hours_settings, timestamptz '2026-01-05 13:00:00+00'
     ) is not false then
    raise exception 'Cairo closed weekly ONLINE interval was not rejected';
  end if;
  if private.catalog_public_online_ordering_open_v1(
       v_hours_settings, timestamptz '2026-01-05 23:30:00+00'
     ) is not true then
    raise exception 'previous-day overnight ONLINE interval did not carry into Cairo next date';
  end if;

  v_hours_settings := jsonb_set(
    v_hours_settings,
    '{specialHours}',
    '[{"serviceDate":"2026-01-05","serviceKind":"ONLINE","timezone":"Africa/Cairo","closed":true,"opensLocal":null,"closesLocal":null}]'::jsonb
  );
  if private.catalog_public_online_ordering_open_v1(
       v_hours_settings, timestamptz '2026-01-05 10:30:00+00'
     ) is not false then
    raise exception 'same-date ONLINE special closure did not override weekly hours';
  end if;

  update public.operations_configuration_snapshots
  set bundle_json = jsonb_set(
    bundle_json,
    '{snapshot,settings,specialHours}',
    jsonb_build_array(
      jsonb_build_object(
        'serviceDate', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
        'serviceKind', 'ONLINE',
        'timezone', 'Africa/Cairo',
        'closed', true,
        'opensLocal', null,
        'closesLocal', null
      )
    ),
    true
  )
  where shop_id = '${shopId}' and version = 2;

  v_result := public.read_catalog_public_ordering_v2('${shopId}');
  if (v_result #>> '{ordering,available}')::boolean is not false then
    raise exception 'public ordering availability ignored current published ONLINE special closure: %', v_result;
  end if;

  v_missing := public.read_catalog_public_ordering_v2('${noSnapshotShopId}');
  if v_missing is not null then
    raise exception 'shop without immutable published settings did not fail closed: %', v_missing;
  end if;

  v_malformed := public.read_catalog_public_ordering_v2('${malformedShopId}');
  if v_malformed is not null then
    raise exception 'malformed published checkout policy did not fail closed: %', v_malformed;
  end if;

  -- Rollout regression: the first emergency toggle on a pre-Plan-2 snapshot must bootstrap
  -- a complete trusted shop identity without routing through mutable Admin settings.
  v_emergency_result := public.update_admin_shop_operational_state_v1(
    '${rolloutEmployeeId}', '${rolloutShopId}', true, true, 0
  );
  if coalesce((v_emergency_result ->> 'ok')::boolean, false) is not true
     or (v_emergency_result ->> 'settingsVersion')::bigint <> 1
     or (v_emergency_result ->> 'operationsConfigurationVersion')::integer <> 2 then
    raise exception 'pre-Plan-2 emergency bootstrap failed: %', v_emergency_result;
  end if;

  select snapshot.bundle_json #> '{snapshot,settings,shopIdentity}'
    into v_emergency_identity
  from public.operations_configuration_snapshots snapshot
  where snapshot.shop_id = '${rolloutShopId}'
  order by snapshot.version desc
  limit 1;

  if v_emergency_identity #>> '{shopId}' is distinct from '${rolloutShopId}'
     or v_emergency_identity #>> '{displayName}' is distinct from 'Rollout Emergency Shop'
     or v_emergency_identity #>> '{address}' is distinct from '12 Rollout Street'
     or v_emergency_identity #>> '{phone}' is distinct from '+201099999999'
     or (v_emergency_identity #>> '{latitude}')::numeric is distinct from 30.044400::numeric
     or (v_emergency_identity #>> '{longitude}')::numeric is distinct from 31.235700::numeric
     or v_emergency_identity #>> '{timezone}' is distinct from 'Africa/Cairo'
     or v_emergency_identity #>> '{lifecycleState}' is distinct from 'ACTIVE'
     or (v_emergency_identity #>> '{temporaryClosed}')::boolean is not true
     or (v_emergency_identity #>> '{onlineOrdersPaused}')::boolean is not true then
    raise exception 'pre-Plan-2 emergency bootstrap published incomplete identity: %', v_emergency_identity;
  end if;

  v_emergency_projection := public.read_catalog_public_ordering_v2('${rolloutShopId}');
  if v_emergency_projection is null
     or (v_emergency_projection #>> '{ordering,temporaryClosed}')::boolean is not true
     or (v_emergency_projection #>> '{ordering,onlineOrdersPaused}')::boolean is not true
     or (v_emergency_projection #>> '{ordering,available}')::boolean is not false then
    raise exception 'pre-Plan-2 emergency bootstrap produced unusable V2 projection: %',
      v_emergency_projection;
  end if;

  if not has_function_privilege('anon', 'public.read_catalog_public_ordering_v2(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.read_catalog_public_ordering_v2(uuid)', 'EXECUTE') then
    raise exception 'public ordering projection is not available through the reviewed public roles';
  end if;
end $$;

rollback;
`;

const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-c', behaviorSql], {
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

console.log('Catalog public ordering projection PostgreSQL behavior passed.');
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910120200_catalog_public_settings_projection.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error('catalog public settings projection migration is missing');
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'read_catalog_public_ordering_v2',
  'security definer',
  'operations_configuration_snapshots',
  'order by',
  'version desc',
  'limit 1',
  'grant execute',
  'anon',
  'authenticated',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`catalog public settings projection migration missing ${fragment}`);
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
      values: { 'checkout.minimumOrderMinor': 4500 },
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

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values
  ('${shopId}', 'Public ordering fixture', true),
  ('${noSnapshotShopId}', 'No published ordering fixture', true);
insert into public.business_shops(business_id, shop_id)
values
  ('${businessId}', '${shopId}'),
  ('${businessId}', '${noSnapshotShopId}');

insert into public.operations_configuration_snapshots(
  shop_id, version, bundle_json, published_at, published_by_auth_user_id
) values
  ('${shopId}', 1, ${quote(JSON.stringify(firstBundle))}::jsonb, now() - interval '1 minute', null),
  ('${shopId}', 2, ${quote(JSON.stringify(latestBundle))}::jsonb, now(), null);

do $$
declare
  v_result jsonb;
  v_missing jsonb;
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
       - 'fulfillmentPreferences'
       - 'paymentPreferences' <> '{}'::jsonb then
    raise exception 'public ordering projection leaked internal policy fields: %', v_result -> 'ordering';
  end if;

  if v_result #>> '{shop,displayName}' <> 'TUX Maadi'
     or v_result #>> '{shop,address}' <> 'Road 9, Maadi'
     or (v_result #>> '{ordering,minimumOrderMinor}')::bigint <> 4500
     or (v_result #>> '{ordering,available}')::boolean is not true then
    raise exception 'latest immutable published snapshot was not projected: %', v_result;
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

  v_missing := public.read_catalog_public_ordering_v2('${noSnapshotShopId}');
  if v_missing is not null then
    raise exception 'shop without immutable published settings did not fail closed: %', v_missing;
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

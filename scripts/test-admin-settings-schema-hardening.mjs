import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910120500_admin_settings_schema_hardening.sql';
if (!fs.existsSync(migrationPath)) {
  throw new Error(`Settings schema hardening migration is missing: ${migrationPath}`);
}
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
  'validate_admin_setting_value_v1',
  'checkout.minimumorderminor',
  'checkout.servicechargebps',
  'receipt.orderprefix',
  'receipt.sequencestart',
]) {
  if (!sql.includes(fragment)) throw new Error(`Settings schema hardening missing ${fragment}`);
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin settings schema hardening static invariant passed.');
  process.exit(0);
}

const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin settings schema hardening behavioral test refuses non-loopback PostgreSQL.');
}

const businessId = '00000000-0000-4000-8000-000000000001';
const shopId = '19000000-0000-4000-8000-000000000051';
const ownerId = '29000000-0000-4000-8000-000000000051';

const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Settings Schema Fixture', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${ownerId}', '${businessId}', 'Settings Schema Owner', 'OWNER', true);

do $$
declare
  v_result jsonb;
begin
  v_result := public.upsert_business_setting_default_v1(
    '${ownerId}', '${shopId}', 'checkout.minimumOrderMinor', '1500'::jsonb, null
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'valid minimum order setting rejected: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'receipt.orderPrefix', '"MD-"'::jsonb, null
  );
  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'valid receipt prefix rejected: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'checkout.futureUnreviewedFlag', 'true'::jsonb, null
  );
  if v_result ->> 'code' <> 'invalid_setting' then
    raise exception 'unknown setting key was accepted: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'checkout.minimumOrderMinor', '"1500"'::jsonb, null
  );
  if v_result ->> 'code' <> 'invalid_setting' then
    raise exception 'wrong minimum-order type was accepted: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'checkout.serviceChargeBps', '10001'::jsonb, null
  );
  if v_result ->> 'code' <> 'invalid_setting' then
    raise exception 'out-of-range service charge was accepted: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'checkout.requireCustomerPhone', '1'::jsonb, null
  );
  if v_result ->> 'code' <> 'invalid_setting' then
    raise exception 'non-boolean customer phone flag was accepted: %', v_result;
  end if;

  v_result := public.upsert_shop_setting_override_v1(
    '${ownerId}', '${shopId}', 'receipt.sequenceStart', '0'::jsonb, null
  );
  if v_result ->> 'code' <> 'invalid_setting' then
    raise exception 'non-positive receipt sequence start was accepted: %', v_result;
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

console.log('Admin settings schema hardening PostgreSQL behavior passed.');

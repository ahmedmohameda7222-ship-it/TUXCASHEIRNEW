import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const migrationPaths = [
  'supabase/migrations/20260910120600_admin_reason_code_edits.sql',
  'supabase/migrations/20260910120900_admin_reason_code_identity_constraint.sql',
];
for (const migrationPath of migrationPaths) {
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Admin reason-code hardening migration is missing: ${migrationPath}`);
  }
}
const sql = migrationPaths.map((migrationPath) => fs.readFileSync(migrationPath, 'utf8')).join('\n');
for (const fragment of [
  'upsert_admin_reason_code_v1',
  "^[A-Za-z][A-Za-z0-9_-]*$",
  'admin_reason_codes_reason_key_format_ck',
  'reason_code_identity_immutable',
  'stale_reason_code_version',
]) {
  if (!sql.includes(fragment)) {
    throw new Error(`Admin reason-code hardening missing ${fragment}`);
  }
}
if (sql.includes("p_reason_key !~ '^[a-z][a-z0-9_-]*$'")) {
  throw new Error('Admin reason-code edit validation still rejects existing uppercase stable keys.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin reason-code edits static invariant passed.');
} else {
  const url = new URL(databaseUrl);
  if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
    throw new Error('Admin reason-code edits behavioral test refuses non-loopback PostgreSQL.');
  }

  const businessId = '00000000-0000-4000-8000-000000000001';
  const shopId = '17000000-0000-4000-8000-000000000093';
  const employeeId = '27000000-0000-4000-8000-000000000093';

  const behaviorSql = String.raw`
begin;

insert into public.shops(id, name, active)
values ('${shopId}', 'Reason Key Fixture', true);
insert into public.business_shops(business_id, shop_id)
values ('${businessId}', '${shopId}');
insert into public.business_employees(id, business_id, display_name, role, active)
values ('${employeeId}', '${businessId}', 'Reason Key Fixture Owner', 'OWNER', true);

do $$
declare
  v_constraint_definition text;
  v_create jsonb;
  v_edit jsonb;
  v_stale jsonb;
  v_identity jsonb;
  v_reason_id uuid;
begin
  select pg_get_constraintdef(c.oid)
    into v_constraint_definition
  from pg_constraint c
  where c.conrelid = 'public.admin_reason_codes'::regclass
    and c.conname = 'admin_reason_codes_reason_key_format_ck';
  if v_constraint_definition is null
     or v_constraint_definition not like '%[A-Za-z][A-Za-z0-9_-]*%' then
    raise exception 'reason-key storage constraint does not preserve uppercase identities: %',
      v_constraint_definition;
  end if;

  v_create := public.upsert_admin_reason_code_v1(
    '${employeeId}', '${shopId}', null, 'KITCHEN_DELAY', 'CANCELLATION',
    'Kitchen delay', true, null
  );
  if coalesce((v_create ->> 'ok')::boolean, false) is not true
     or (v_create ->> 'version')::bigint <> 1 then
    raise exception 'uppercase reason create failed: %', v_create;
  end if;
  v_reason_id := (v_create ->> 'reasonCodeId')::uuid;

  v_edit := public.upsert_admin_reason_code_v1(
    '${employeeId}', '${shopId}', v_reason_id, 'KITCHEN_DELAY', 'CANCELLATION',
    'Kitchen delay updated', false, 1
  );
  if coalesce((v_edit ->> 'ok')::boolean, false) is not true
     or (v_edit ->> 'version')::bigint <> 2 then
    raise exception 'uppercase reason edit failed: %', v_edit;
  end if;

  v_stale := public.upsert_admin_reason_code_v1(
    '${employeeId}', '${shopId}', v_reason_id, 'KITCHEN_DELAY', 'CANCELLATION',
    'Stale label', true, 1
  );
  if v_stale ->> 'code' <> 'stale_reason_code_version'
     or (v_stale ->> 'currentVersion')::bigint <> 2 then
    raise exception 'stale reason edit was not fenced: %', v_stale;
  end if;

  v_identity := public.upsert_admin_reason_code_v1(
    '${employeeId}', '${shopId}', v_reason_id, 'KITCHEN_DELAY_CHANGED', 'CANCELLATION',
    'Identity mutation', false, 2
  );
  if v_identity ->> 'code' <> 'reason_code_identity_immutable' then
    raise exception 'reason identity mutation was not rejected: %', v_identity;
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
  console.log('Admin reason-code edits PostgreSQL behavior passed.');
}

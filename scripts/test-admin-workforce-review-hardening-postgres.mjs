import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const targetMigration = '20261002221500_admin_workforce_review_hardening.sql';
if (!existsSync(resolve('supabase/migrations', targetMigration))) {
  throw new Error('Admin Plan 6 Workforce hardening migration missing from repository chain.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin Workforce deep-review PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Workforce deep-review PostgreSQL test refuses non-loopback PostgreSQL.');
}

function psql(args, label, { allowFailure = false } = {}) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result;
}
function scalar(sql, label) {
  return psql(['-At', '-c', sql], label).stdout.trim();
}
function rpc(sql, label) {
  return JSON.parse(scalar(`select (${sql})::text`, label));
}

psql(
  ['-c', `
drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets (id text primary key, name text not null unique, public boolean not null default false);
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`],
  'Workforce deep-review fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Workforce hardening migration missing');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve('supabase/migrations', migration)], migration);
}

const B1 = '31000000-0000-4000-8000-000000000001';
const B2 = '31000000-0000-4000-8000-000000000002';
const S1 = '32000000-0000-4000-8000-000000000001';
const S2 = '32000000-0000-4000-8000-000000000002';
const S3 = '32000000-0000-4000-8000-000000000003';
const OWNER = '33000000-0000-4000-8000-000000000001';
const MANAGER = '33000000-0000-4000-8000-000000000002';
const ADMIN = '33000000-0000-4000-8000-000000000003';
const SHOP2_STAFF = '33000000-0000-4000-8000-000000000004';
const SUSPENDED = '33000000-0000-4000-8000-000000000005';
const LEAVE_STAFF = '33000000-0000-4000-8000-000000000006';
const DST_STAFF = '33000000-0000-4000-8000-000000000007';
const LONE_OWNER = '33000000-0000-4000-8000-000000000008';
const ACTIVE_WORKER = '34000000-0000-4000-8000-000000000001';

const verifier = (letter) => `pbkdf2-sha256$210000$${letter.repeat(32)}$${letter.repeat(64)}`;
psql(
  ['-c', `
insert into public.businesses(id, name) values ('${B1}', 'Review A'), ('${B2}', 'Review B');
insert into public.shops(id, name, active) values
  ('${S1}', 'Review Shop 1', true),
  ('${S2}', 'Review Shop 2', true),
  ('${S3}', 'Review Shop 3', true);
insert into public.business_shops(business_id, shop_id) values
  ('${B1}', '${S1}'), ('${B1}', '${S2}'), ('${B2}', '${S3}');
insert into public.business_employees(id, business_id, display_name, role, pin_lookup_hash, pin_hash, active)
values
  ('${OWNER}', '${B1}', 'Owner', 'OWNER', repeat('1',64), '${verifier('a')}', true),
  ('${MANAGER}', '${B1}', 'Manager', 'MANAGER', repeat('2',64), '${verifier('b')}', true),
  ('${ADMIN}', '${B1}', 'Admin', 'ADMIN', repeat('3',64), '${verifier('c')}', true),
  ('${SHOP2_STAFF}', '${B1}', 'Shop 2 Staff', 'STAFF', repeat('4',64), '${verifier('d')}', true),
  ('${SUSPENDED}', '${B1}', 'Suspended Staff', 'STAFF', repeat('5',64), '${verifier('e')}', false),
  ('${LEAVE_STAFF}', '${B1}', 'Leave Staff', 'STAFF', repeat('6',64), '${verifier('f')}', true),
  ('${DST_STAFF}', '${B1}', 'DST Staff', 'STAFF', repeat('7',64), '${verifier('7')}', true),
  ('${LONE_OWNER}', '${B2}', 'Lone Owner', 'OWNER', repeat('8',64), '${verifier('8')}', true);
insert into public.employee_shop_assignments(business_id, employee_id, shop_id) values
  ('${B1}', '${OWNER}', '${S1}'), ('${B1}', '${OWNER}', '${S2}'),
  ('${B1}', '${MANAGER}', '${S1}'),
  ('${B1}', '${ADMIN}', '${S1}'),
  ('${B1}', '${SHOP2_STAFF}', '${S2}'),
  ('${B1}', '${SUSPENDED}', '${S1}'),
  ('${B1}', '${LEAVE_STAFF}', '${S2}'),
  ('${B1}', '${DST_STAFF}', '${S1}'),
  ('${B2}', '${LONE_OWNER}', '${S3}');
insert into public.admin_employee_permissions(business_id, employee_id, permission_key, effect)
values
  ('${B1}', '${MANAGER}', 'staff.manage', 'ALLOW'),
  ('${B1}', '${SHOP2_STAFF}', 'staff.manage', 'ALLOW');
insert into public.workers(id, shop_id, display_name, pin_hash, active, pin_lookup_hash)
values ('${ACTIVE_WORKER}', '${S1}', 'Active Worker', '${verifier('9')}', true, repeat('9',64));
insert into public.employee_shifts(
  business_id, employee_id, shop_id, starts_at, ends_at, planned_break_minutes,
  status, created_by_employee_id, updated_by_employee_id, create_command_id
)
values (
  '${B1}', '${DST_STAFF}', '${S1}', '2026-10-24T06:00:00Z', '2026-10-24T14:00:00Z', 0,
  'SCHEDULED', '${OWNER}', '${OWNER}', 'review-dst-source'
);
`],
  'Workforce deep-review fixtures',
);

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

const adminCredentialVersion = Number(
  scalar(`select credential_version from public.business_employees where id='${ADMIN}'`, 'admin credential version'),
);
const adminWorkerFingerprint = scalar(
  `select private.workforce_worker_state_fingerprint_v1('${ADMIN}', array['${S1}'::uuid])`,
  'admin worker fingerprint',
);
const pinStage = rpc(
  `public.stage_employee_pin_change_v1('${MANAGER}','${ADMIN}',array['${S1}'::uuid],'${verifier('0')}',repeat('a',64),${adminCredentialVersion},'${adminWorkerFingerprint}',now()+interval '10 minutes','35000000-0000-4000-8000-000000000001')`,
  'manager PIN reset against admin',
);
expect(
  pinStage.ok === false && pinStage.code === 'role_escalation_forbidden',
  `lower-role actor staged ADMIN PIN reset: ${JSON.stringify(pinStage)}`,
);

const adminProfileVersion = Number(
  scalar(`select profile_version from public.business_employees where id='${ADMIN}'`, 'admin profile version'),
);
const suspendAdmin = rpc(
  `public.suspend_employee_v1('${MANAGER}','${ADMIN}',${adminProfileVersion},'review-suspend-admin')`,
  'manager suspend admin',
);
expect(
  suspendAdmin.ok === false && suspendAdmin.code === 'role_escalation_forbidden',
  `lower-role actor suspended ADMIN: ${JSON.stringify(suspendAdmin)}`,
);

const crossShopAssign = rpc(
  `public.assign_employee_to_shop_v1('${MANAGER}','${SHOP2_STAFF}','${S1}','review-cross-shop-assign')`,
  'cross-shop employee assignment',
);
expect(
  crossShopAssign.ok === false &&
    ['employee_scope_forbidden', 'shop_forbidden', 'shop_not_assigned'].includes(crossShopAssign.code),
  `shop-scoped actor pulled an out-of-scope employee into their shop: ${JSON.stringify(crossShopAssign)}`,
);

const staffCreatesManager = rpc(
  `public.create_employee_v1('${SHOP2_STAFF}','${S2}','Escalated Manager',null,null,null,'MANAGER','review-staff-create-manager')`,
  'staff creates manager',
);
expect(
  staffCreatesManager.ok === false && staffCreatesManager.code === 'role_escalation_forbidden',
  `STAFF with staff.manage created a MANAGER: ${JSON.stringify(staffCreatesManager)}`,
);

const crossShopComp = rpc(
  `public.set_employee_compensation_v1('${MANAGER}','${SHOP2_STAFF}','${S1}','HOURLY',2500,'2026-10-01','review-cross-shop-comp')`,
  'cross-shop compensation',
);
expect(
  crossShopComp.ok === false &&
    [
      'employee_shop_assignment_required',
      'employee_scope_forbidden',
      'shop_forbidden',
      'shop_not_assigned',
    ].includes(crossShopComp.code),
  `shop-scoped actor changed out-of-scope employee compensation: ${JSON.stringify(crossShopComp)}`,
);

const suspendedLink = rpc(
  `public.link_employee_worker_v1('${OWNER}','${SUSPENDED}','${S1}','${ACTIVE_WORKER}','review-link-suspended')`,
  'link suspended employee',
);
expect(
  suspendedLink.ok === false && suspendedLink.code === 'employee_inactive',
  `suspended employee gained a new Operations identity: ${JSON.stringify(suspendedLink)}`,
);

const loneOwnerVersion = Number(
  scalar(`select profile_version from public.business_employees where id='${LONE_OWNER}'`, 'lone owner version'),
);
const lastOwnerSuspend = rpc(
  `public.suspend_employee_v1('${LONE_OWNER}','${LONE_OWNER}',${loneOwnerVersion},'review-last-owner-suspend')`,
  'suspend last owner',
);
expect(
  lastOwnerSuspend.ok === false && lastOwnerSuspend.code === 'last_owner_required',
  `last active OWNER was suspended: ${JSON.stringify(lastOwnerSuspend)}`,
);

const leave = rpc(
  `public.create_leave_request_v1('${OWNER}','${LEAVE_STAFF}',null,'VACATION','2026-11-10','2026-11-11','business-wide leave','review-business-wide-leave')`,
  'business-wide leave',
);
expect(leave.ok === true, `business-wide leave contract is dead: ${JSON.stringify(leave)}`);

const copy = rpc(
  `public.copy_previous_week_shifts_v1('${OWNER}','${DST_STAFF}','${S1}','2026-10-26','review-dst-copy')`,
  'DST shift copy',
);
expect(copy.ok === true, `DST shift copy failed: ${JSON.stringify(copy)}`);
if (copy.ok === true) {
  const copiedLocal = scalar(
    `select to_char(starts_at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI') from public.employee_shifts where employee_id='${DST_STAFF}' and starts_at >= '2026-10-26T00:00:00Z' order by starts_at limit 1`,
    'copied DST local start',
  );
  expect(
    copiedLocal === '2026-10-31 09:00',
    `DST copy changed Cairo wall-clock start: ${copiedLocal}`,
  );
}

if (failures.length > 0) {
  console.error('Admin Workforce deep-review RED regressions:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Admin Workforce deep-review PostgreSQL regressions passed.');

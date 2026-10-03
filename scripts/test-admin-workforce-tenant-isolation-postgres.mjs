import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const targetMigration = '20261003101500_admin_workforce_pin_tenant_isolation.sql';
if (!existsSync(resolve('supabase/migrations', targetMigration))) {
  throw new Error('Admin Plan 6 Workforce PIN tenant-isolation migration missing.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin Workforce tenant-isolation PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin Workforce tenant-isolation test refuses non-loopback PostgreSQL.');
}

function psql(args, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
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
  'Workforce tenant-isolation fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Workforce PIN tenant-isolation migration missing');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve('supabase/migrations', migration)], migration);
}

const B1 = '41000000-0000-4000-8000-000000000001';
const B2 = '41000000-0000-4000-8000-000000000002';
const S1 = '42000000-0000-4000-8000-000000000001';
const S2 = '42000000-0000-4000-8000-000000000002';
const OWNER1 = '43000000-0000-4000-8000-000000000001';
const TARGET1 = '43000000-0000-4000-8000-000000000002';
const SUSPENDED1 = '43000000-0000-4000-8000-000000000003';
const OWNER2 = '43000000-0000-4000-8000-000000000004';
const STAFF2 = '43000000-0000-4000-8000-000000000005';
const STAGE_COMMAND = '45000000-0000-4000-8000-000000000001';
const verifier = (digit) => `pbkdf2-sha256$210000$${digit.repeat(32)}$${digit.repeat(64)}`;

psql(
  ['-c', `
insert into public.businesses(id, name) values ('${B1}', 'Tenant A'), ('${B2}', 'Tenant B');
insert into public.shops(id, name, active) values ('${S1}', 'Tenant A Shop', true), ('${S2}', 'Tenant B Shop', true);
insert into public.business_shops(business_id, shop_id) values ('${B1}', '${S1}'), ('${B2}', '${S2}');
insert into public.business_employees(id, business_id, display_name, role, pin_lookup_hash, pin_hash, active)
values
  ('${OWNER1}', '${B1}', 'Owner A', 'OWNER', repeat('1',64), '${verifier('1')}', true),
  ('${TARGET1}', '${B1}', 'Target A', 'STAFF', repeat('2',64), '${verifier('2')}', true),
  ('${SUSPENDED1}', '${B1}', 'Suspended A', 'STAFF', repeat('9',64), '${verifier('9')}', false),
  ('${OWNER2}', '${B2}', 'Owner B', 'OWNER', repeat('8',64), '${verifier('8')}', true),
  ('${STAFF2}', '${B2}', 'Staff B', 'STAFF', repeat('9',64), '${verifier('9')}', true);
insert into public.employee_shop_assignments(business_id, employee_id, shop_id) values
  ('${B1}', '${OWNER1}', '${S1}'), ('${B1}', '${TARGET1}', '${S1}'), ('${B1}', '${SUSPENDED1}', '${S1}'),
  ('${B2}', '${OWNER2}', '${S2}'), ('${B2}', '${STAFF2}', '${S2}');
`],
  'Workforce tenant-isolation fixtures',
);

const fingerprint = scalar(
  `select private.workforce_worker_state_fingerprint_v1('${TARGET1}', array['${S1}'::uuid])`,
  'target worker fingerprint',
);
const stage = rpc(
  `public.stage_employee_pin_change_v1('${OWNER1}','${TARGET1}',array['${S1}'::uuid],'${verifier('8')}',repeat('8',64),1,'${fingerprint}',now()+interval '10 minutes','${STAGE_COMMAND}')`,
  'stage same PIN used only in another business',
);
if (!stage.ok) {
  throw new Error(`cross-tenant employee PIN incorrectly blocked staging: ${JSON.stringify(stage)}`);
}
if (typeof stage.commandRef !== 'string') {
  throw new Error(`credential command ref missing: ${JSON.stringify(stage)}`);
}

const apply = rpc(
  `public.apply_employee_pin_change_v1('${OWNER1}','${stage.commandRef}')`,
  'apply same PIN used only in another business',
);
if (!apply.ok) {
  throw new Error(`cross-tenant employee PIN incorrectly blocked apply: ${JSON.stringify(apply)}`);
}
const targetLookup = scalar(
  `select pin_lookup_hash from public.business_employees where id='${TARGET1}'`,
  'target lookup after apply',
);
if (targetLookup !== '8'.repeat(64)) {
  throw new Error('target employee PIN lookup was not updated after tenant-isolated apply');
}

const suspendedVersion = Number(
  scalar(`select profile_version from public.business_employees where id='${SUSPENDED1}'`, 'suspended profile version'),
);
const reactivate = rpc(
  `public.reactivate_employee_v1('${OWNER1}','${SUSPENDED1}',${suspendedVersion},'${S1}','tenant-isolation-reactivate')`,
  'reactivate same PIN used only in another business',
);
if (!reactivate.ok) {
  throw new Error(`cross-tenant employee PIN incorrectly blocked reactivation: ${JSON.stringify(reactivate)}`);
}

console.log('Admin Workforce tenant-isolation PostgreSQL behavior passed.');

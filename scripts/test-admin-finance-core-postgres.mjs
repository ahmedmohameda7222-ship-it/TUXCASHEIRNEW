import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const targetMigration = '20260910195000_admin_finance_core.sql';
const targetPath = resolve('supabase/migrations', targetMigration);
if (!existsSync(targetPath)) {
  throw new Error('Admin Plan 6 finance-core migration missing from repository chain.');
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin finance-core PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname)) {
  throw new Error('Admin finance-core PostgreSQL test refuses non-loopback PostgreSQL.');
}

function psql(args, label) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
  return result.stdout;
}
function scalar(sql, label) {
  return psql(['-At', '-c', sql], label).trim();
}
function rpc(sql, label) {
  return JSON.parse(scalar(`select (${sql})::text`, label));
}

psql(
  [
    '-c',
    `drop schema if exists public cascade;
     create schema public;
     drop schema if exists private cascade;
     create schema private;
     drop schema if exists auth cascade;
     create schema auth;
     drop schema if exists storage cascade;
     create schema storage;
     create table storage.buckets (
       id text primary key,
       name text not null unique,
       public boolean not null default false
     );
     do $$
     begin
       if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated noinherit; end if;
       if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role noinherit; end if;
     end $$;
     grant usage on schema public to anon, authenticated, service_role;
     create table auth.users(id uuid primary key);
     create function auth.uid() returns uuid language sql stable as $$
       select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
     $$;`,
  ],
  'Finance-core fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const targetIndex = migrations.indexOf(targetMigration);
if (targetIndex < 0) throw new Error('Admin finance-core migration missing from repository chain.');
for (const migration of migrations.slice(0, targetIndex + 1)) {
  psql(['-f', resolve('supabase/migrations', migration)], migration);
}

const unseeded = JSON.parse(
  scalar(
    `select jsonb_build_object(
       'accounts', (select count(*) from public.finance_accounts),
       'movements', (select count(*) from public.finance_movements),
       'mappings', (select count(*) from public.payment_method_finance_accounts)
     )::text`,
    'Finance-core no-fictional-seed readback',
  ),
);
if (Number(unseeded.accounts) !== 0 || Number(unseeded.movements) !== 0 || Number(unseeded.mappings) !== 0) {
  throw new Error(`Finance core seeded fictional state: ${JSON.stringify(unseeded)}`);
}

const privilegeReadback = JSON.parse(
  scalar(
    `select jsonb_build_object(
       'accountsRls', (select relrowsecurity from pg_class where oid='public.finance_accounts'::regclass),
       'movementsRls', (select relrowsecurity from pg_class where oid='public.finance_movements'::regclass),
       'mappingRls', (select relrowsecurity from pg_class where oid='public.payment_method_finance_accounts'::regclass),
       'anonAccounts', has_table_privilege('anon', 'public.finance_accounts', 'SELECT,INSERT,UPDATE,DELETE'),
       'authAccounts', has_table_privilege('authenticated', 'public.finance_accounts', 'SELECT,INSERT,UPDATE,DELETE'),
       'anonMovements', has_table_privilege('anon', 'public.finance_movements', 'SELECT,INSERT,UPDATE,DELETE'),
       'authMovements', has_table_privilege('authenticated', 'public.finance_movements', 'SELECT,INSERT,UPDATE,DELETE'),
       'anonMapping', has_table_privilege('anon', 'public.payment_method_finance_accounts', 'SELECT,INSERT,UPDATE,DELETE'),
       'authMapping', has_table_privilege('authenticated', 'public.payment_method_finance_accounts', 'SELECT,INSERT,UPDATE,DELETE'),
       'anonRpc', has_function_privilege('anon', 'public.post_finance_movement_v1(uuid,uuid,uuid,text,bigint,text,text,text,text,text)', 'EXECUTE'),
       'authRpc', has_function_privilege('authenticated', 'public.post_finance_movement_v1(uuid,uuid,uuid,text,bigint,text,text,text,text,text)', 'EXECUTE'),
       'serviceRpc', has_function_privilege('service_role', 'public.post_finance_movement_v1(uuid,uuid,uuid,text,bigint,text,text,text,text,text)', 'EXECUTE')
     )::text`,
    'Finance-core privilege readback',
  ),
);
for (const key of ['accountsRls', 'movementsRls', 'mappingRls', 'serviceRpc']) {
  if (privilegeReadback[key] !== true) throw new Error(`Expected ${key}=true: ${JSON.stringify(privilegeReadback)}`);
}
for (const key of ['anonAccounts','authAccounts','anonMovements','authMovements','anonMapping','authMapping','anonRpc','authRpc']) {
  if (privilegeReadback[key] !== false) throw new Error(`Expected ${key}=false: ${JSON.stringify(privilegeReadback)}`);
}

const BUSINESS_A = '10000000-0000-4000-8000-000000000001';
const BUSINESS_B = '10000000-0000-4000-8000-000000000002';
const SHOP_A = '11000000-0000-4000-8000-000000000001';
const SHOP_B = '11000000-0000-4000-8000-000000000002';
const SHOP_C = '11000000-0000-4000-8000-000000000003';
const EMPLOYEE = '12000000-0000-4000-8000-000000000001';
const ACCOUNT = '13000000-0000-4000-8000-000000000001';
const INACTIVE = '13000000-0000-4000-8000-000000000002';
const WRONG_SHOP = '13000000-0000-4000-8000-000000000003';
const WRONG_BUSINESS = '13000000-0000-4000-8000-000000000004';
const PAYMENT_METHOD = '14000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.businesses(id, name) values
       ('${BUSINESS_A}', 'Finance A'),
       ('${BUSINESS_B}', 'Finance B');
     insert into public.shops(id, name, active) values
       ('${SHOP_A}', 'Finance Shop A', true),
       ('${SHOP_B}', 'Finance Shop B', true),
       ('${SHOP_C}', 'Finance Shop C', true);
     insert into public.business_shops(business_id, shop_id) values
       ('${BUSINESS_A}', '${SHOP_A}'),
       ('${BUSINESS_A}', '${SHOP_B}'),
       ('${BUSINESS_B}', '${SHOP_C}');
     insert into public.business_employees(id, business_id, display_name, role, active)
       values ('${EMPLOYEE}', '${BUSINESS_A}', 'Finance Owner', 'OWNER', true);
     insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
       values ('${BUSINESS_A}', '${EMPLOYEE}', '${SHOP_A}');
     insert into public.finance_accounts(
       id,business_id,shop_id,account_type,name,active,opening_balance_minor
     ) values
       ('${ACCOUNT}','${BUSINESS_A}','${SHOP_A}','CASH','Till A',true,0),
       ('${INACTIVE}','${BUSINESS_A}','${SHOP_A}','BANK','Old Bank',false,0),
       ('${WRONG_SHOP}','${BUSINESS_A}','${SHOP_B}','CASH','Till B',true,0),
       ('${WRONG_BUSINESS}','${BUSINESS_B}','${SHOP_C}','CASH','Till C',true,0);
     insert into public.payment_methods(
       id,shop_id,display_name,logic_type,requires_reconciliation,active,sort_order
     ) values ('${PAYMENT_METHOD}','${SHOP_A}','Cash','CASH',false,true,0);
     insert into public.payment_method_finance_accounts(
       business_id,shop_id,payment_method_id,finance_account_id,active
     ) values ('${BUSINESS_A}','${SHOP_A}','${PAYMENT_METHOD}','${ACCOUNT}',true);`,
  ],
  'Finance-core fixture seed',
);

const posted = rpc(
  `public.post_finance_movement_v1(
    '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${ACCOUNT}'::uuid,
    'STAFF_PAYMENT',-5000,'finance-cmd-1','STAFF_PAYMENT','staff-record-1','STAFF_PAYMENT','PRIMARY'
  )`,
  'Post finance movement',
);
if (posted.ok !== true || posted.replayed !== false) throw new Error(`posting failed: ${JSON.stringify(posted)}`);

const replay = rpc(
  `public.post_finance_movement_v1(
    '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${ACCOUNT}'::uuid,
    'STAFF_PAYMENT',-5000,'finance-cmd-1','STAFF_PAYMENT','staff-record-1','STAFF_PAYMENT','PRIMARY'
  )`,
  'Replay finance movement',
);
if (replay.ok !== true || replay.replayed !== true || replay.movementId !== posted.movementId) {
  throw new Error(`replay was not deterministic: ${JSON.stringify({posted,replay})}`);
}

const changed = rpc(
  `public.post_finance_movement_v1(
    '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${ACCOUNT}'::uuid,
    'STAFF_PAYMENT',-6000,'finance-cmd-1','STAFF_PAYMENT','staff-record-1','STAFF_PAYMENT','PRIMARY'
  )`,
  'Reject changed finance command payload',
);
if (changed.ok !== false || changed.code !== 'finance_command_conflict') {
  throw new Error(`changed command did not conflict: ${JSON.stringify(changed)}`);
}

for (const [accountId, expectedCode, label] of [
  [INACTIVE, 'finance_account_inactive', 'inactive account'],
  [WRONG_SHOP, 'finance_account_shop_forbidden', 'wrong-shop account'],
  [WRONG_BUSINESS, 'finance_account_forbidden', 'cross-business account'],
]) {
  const result = rpc(
    `public.post_finance_movement_v1(
      '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${accountId}'::uuid,
      'STAFF_PAYMENT',-1000,'${label.replaceAll(' ', '-')}',null,null,null,'PRIMARY'
    )`,
    `Reject ${label}`,
  );
  if (result.ok !== false || result.code !== expectedCode) {
    throw new Error(`${label} was accepted: ${JSON.stringify(result)}`);
  }
}

const invalidSign = rpc(
  `public.post_finance_movement_v1(
    '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${ACCOUNT}'::uuid,
    'STAFF_PAYMENT',5000,'finance-positive-staff-payment',null,null,null,'PRIMARY'
  )`,
  'Reject positive staff payment',
);
if (invalidSign.ok !== false || invalidSign.code !== 'finance_amount_sign_invalid') {
  throw new Error(`positive STAFF_PAYMENT was accepted: ${JSON.stringify(invalidSign)}`);
}

const movementCount = Number(
  scalar(
    `select count(*) from public.finance_movements where business_id='${BUSINESS_A}' and command_id='finance-cmd-1'`,
    'Finance movement replay count',
  ),
);
if (movementCount !== 1) throw new Error(`replay created ${movementCount} movements`);

const sourceConflict = rpc(
  `public.post_finance_movement_v1(
    '${EMPLOYEE}'::uuid,'${SHOP_A}'::uuid,'${ACCOUNT}'::uuid,
    'STAFF_PAYMENT',-5000,'finance-cmd-2','STAFF_PAYMENT','staff-record-1','STAFF_PAYMENT','PRIMARY'
  )`,
  'Reject duplicate canonical source effect',
);
if (sourceConflict.ok !== false || sourceConflict.code !== 'finance_source_conflict') {
  throw new Error(`duplicate source effect was accepted: ${JSON.stringify(sourceConflict)}`);
}

console.log('Admin Plan 6 finance-core PostgreSQL scope/idempotency behavior passed.');

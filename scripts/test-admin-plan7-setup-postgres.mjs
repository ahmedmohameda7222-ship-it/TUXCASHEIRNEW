import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '::1'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Plan 7 setup test requires a loopback PostgreSQL TEST_DATABASE_URL');
}
function psql(sql, label, shouldFail = false) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status === 0) === shouldFail) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`Plan 7 setup ${label} unexpectedly ${shouldFail ? 'passed' : 'failed'}`);
  }
  return result.stdout.trim();
}
function rpc(sql, label) {
  return JSON.parse(psql(`select (${sql})::text`, label));
}

psql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false);
do $$ begin
if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
`, 'isolated fixture reset');

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const target = '20261008103000_admin_plan7_expense_categories.sql';
assert(migrations.includes(target), 'setup migration missing');
for (const name of migrations.slice(0, migrations.indexOf(target) + 1)) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`setup prerequisite migration failed: ${name}`);
  }
}

const b = '31000000-0000-4000-8000-000000000001';
const s = '32000000-0000-4000-8000-000000000001';
const s2 = '32000000-0000-4000-8000-000000000002';
const e = '33000000-0000-4000-8000-000000000001';
const pm = '34000000-0000-4000-8000-000000000001';
psql(`
insert into public.businesses(id,name) values ('${b}','Plan 7 setup');
insert into public.shops(id,name,active) values ('${s}','Cashier shop',true),('${s2}','Other shop',true);
insert into public.business_shops(business_id,shop_id)
  values ('${b}','${s}'),('${b}','${s2}');
insert into public.business_employees(id,business_id,display_name,role,active)
  values ('${e}','${b}','Owner','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
  values ('${b}','${e}','${s}');
insert into public.payment_methods(id,shop_id,display_name,logic_type,active,sort_order)
  values ('${pm}','${s}','Cash','CASH',true,1);
`, 'zero-account fixture');
assert.equal(psql('select count(*) from public.finance_accounts', 'no account seeding'), '0');
const zeroWorkspace = rpc(`public.finance_workspace_v1('${e}'::uuid,'${s}'::uuid)`, 'zero-account workspace');
assert.equal(zeroWorkspace.setupState, 'SETUP_REQUIRED');
assert.deepEqual(zeroWorkspace.accounts, []);
assert.equal(zeroWorkspace.moneyPosition, null);
assert.equal(psql('select count(*) from public.payment_method_finance_accounts', 'no mapping seeding'), '0');

const callCreate = (name, commandId = 'create-cash') =>
  `public.create_finance_account_v1('${e}'::uuid,'${s}'::uuid,'${s}'::uuid,'CASH','${name}',12500,'${commandId}')`;
const created = rpc(callCreate('Front Till'), 'create explicit cash account');
assert.equal(created.ok, true);
assert.equal(created.replayed, false);
assert.equal(rpc(callCreate('Front Till'), 'idempotent account replay').replayed, true);
assert.equal(rpc(callCreate('Changed Name'), 'conflicting account replay').code, 'finance_command_conflict');
assert.equal(psql('select count(*) from public.finance_accounts', 'no duplicate account'), '1');
const beforeMap = rpc(`public.finance_workspace_v1('${e}'::uuid,'${s}'::uuid)`, 'unmapped workspace');
assert.equal(beforeMap.setupState, 'NEEDS_ATTENTION');
assert.equal(beforeMap.moneyPosition.totalTrackedMoneyMinor, 12500);

const accountId = created.accountId;
const callMap = (accountIdInput, version, commandId) =>
  `public.set_payment_method_finance_account_v1('${e}'::uuid,'${s}'::uuid,'${pm}'::uuid,${accountIdInput ? `'${accountIdInput}'::uuid` : 'null::uuid'},${version},'${commandId}')`;
const mapped = rpc(callMap(accountId, 0, 'map-1'), 'explicit payment mapping');
assert.equal(mapped.ok, true);
assert.equal(mapped.mapped, true);
assert.equal(mapped.version, 1);
assert.equal(rpc(callMap(accountId, 0, 'map-1'), 'mapping replay').replayed, true);
assert.equal(rpc(callMap(accountId, 0, 'stale-map'), 'stale version conflict').code, 'finance_mapping_version_conflict');
assert.equal(psql('select count(*) from public.payment_method_finance_accounts where active', 'one active mapping'), '1');
const linkedWorkspace = rpc(`public.finance_workspace_v1('${e}'::uuid,'${s}'::uuid)`, 'mapped workspace');
assert.equal(linkedWorkspace.setupState, 'READY');
assert.equal(linkedWorkspace.accounts[0].balanceMinor, 12500);
assert.equal(linkedWorkspace.paymentMethods[0].mappingVersion, 1);

const stillMapped = rpc(
  `public.set_finance_account_active_v1('${e}'::uuid,'${s}'::uuid,'${accountId}'::uuid,1,false,'deactivate-before-unmap')`,
  'active mapping prevents account deactivation',
);
assert.equal(stillMapped.ok, false);
assert.equal(stillMapped.code, 'finance_account_has_active_mapping');
const unmapped = rpc(callMap(null, 1, 'unmap-2'), 'intentionally unmapped');
assert.equal(unmapped.ok, true);
assert.equal(unmapped.mapped, false);
assert.equal(psql('select count(*) from public.payment_method_finance_accounts where active', 'disabled mapping'), '0');
const deactivated = rpc(
  `public.set_finance_account_active_v1('${e}'::uuid,'${s}'::uuid,'${accountId}'::uuid,1,false,'deactivate-after-unmap')`,
  'deactivate preserved account',
);
assert.equal(deactivated.ok, true);
assert.equal(deactivated.active, false);
assert.equal(psql('select count(*) from public.finance_accounts', 'deactivation never deletes'), '1');
assert.equal(psql(`select opening_balance_minor from public.finance_accounts where id='${accountId}'`, 'opening balance immutable in setup'), '12500');

const crossShop = rpc(
  `public.create_finance_account_v1('${e}'::uuid,'${s}'::uuid,'${s2}'::uuid,'BANK','Wrong shop',0,'bad-scope')`,
  'reject another shop',
);
assert.equal(crossShop.ok, false);
assert.equal(crossShop.code, 'finance_scope_invalid');
const unauthorized = rpc(
  `public.create_finance_account_v1(gen_random_uuid(),'${s}'::uuid,'${s}'::uuid,'BANK','Unauthorized',0,'bad-user')`,
  'reject unauthorized',
);
assert.equal(unauthorized.ok, false);
assert.equal(unauthorized.code, 'permission_forbidden');

for (const sig of [
  'public.create_finance_account_v1(uuid,uuid,uuid,text,text,bigint,text)',
  'public.set_finance_account_active_v1(uuid,uuid,uuid,bigint,boolean,text)',
  'public.set_payment_method_finance_account_v1(uuid,uuid,uuid,uuid,bigint,text)',
]) {
  assert.equal(psql(`select has_function_privilege('anon','${sig}','EXECUTE')`, 'anon cannot execute setup RPC'), 'f');
  assert.equal(psql(`select has_function_privilege('authenticated','${sig}','EXECUTE')`, 'browser cannot execute setup RPC'), 'f');
  assert.equal(psql(`select has_function_privilege('service_role','${sig}','EXECUTE')`, 'BFF can execute setup RPC'), 't');
}
console.log('Plan 7 Finance account setup/authorization/replay/mapping PostgreSQL behavior passed.');

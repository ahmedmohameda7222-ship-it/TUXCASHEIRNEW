import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = '20261012021036_admin_first_operations_worker_provisioning.sql';
if (!existsSync(resolve('supabase/migrations', migration)))
  throw new Error('Missing provisioning migration');
const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Isolated worker provisioning test skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing to mutate non-loopback PostgreSQL');
}
function sql(query, label) {
  const result = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(label + ': ' + (result.stderr || result.stdout));
  }
  return result.stdout.trim();
}
function file(path) {
  const result = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', path], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(path + ': ' + (result.stderr || result.stdout));
}
function call(actor, employee, shop, command) {
  return JSON.parse(
    sql(
      "select public.provision_employee_operations_worker_v1('" +
        actor +
        "','" +
        employee +
        "','" +
        shop +
        "','" +
        command +
        "')::text",
      'provision RPC',
    ),
  );
}
function deny(response, code) {
  if (response.ok !== false || response.code !== code) {
    throw new Error('Expected ' + code + ', received: ' + JSON.stringify(response));
  }
}
const B = '51000000-0000-4000-8000-000000000001';
const B2 = '51000000-0000-4000-8000-000000000002';
const S = '52000000-0000-4000-8000-000000000001';
const S2 = '52000000-0000-4000-8000-000000000002';
const S3 = '52000000-0000-4000-8000-000000000003';
const O = '53000000-0000-4000-8000-000000000001';
const E = '53000000-0000-4000-8000-000000000002';
const M = '53000000-0000-4000-8000-000000000003';
const U = '53000000-0000-4000-8000-000000000004';
const O2 = '53000000-0000-4000-8000-000000000005';
const W = '54000000-0000-4000-8000-000000000001';
const verifier = (digit) => 'pbkdf2-sha256$210000$' + digit.repeat(32) + '$' + digit.repeat(64);

sql(
  [
    'drop schema if exists public cascade; create schema public;',
    'drop schema if exists private cascade; create schema private;',
    'drop schema if exists auth cascade; create schema auth;',
    'drop schema if exists storage cascade; create schema storage;',
    'create table storage.buckets (id text primary key, name text not null unique, public boolean not null default false);',
    "do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;",
    "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;",
    "if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if; end $$;",
    'grant usage on schema public to anon, authenticated, service_role;',
    'create table auth.users(id uuid primary key);',
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
  ].join('\n'),
  'isolated database fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((n) => /^\d+_.+\.sql$/.test(n))
  .sort();
const index = migrations.indexOf(migration);
if (index < 0) throw new Error('Provisioning migration absent from source chain');
for (const name of migrations.slice(0, index + 1)) file(resolve('supabase/migrations', name));

function employee(id, business, name, role, digit, active = true) {
  return (
    "('" +
    id +
    "','" +
    business +
    "','" +
    name +
    "','" +
    role +
    "'," +
    (digit === null ? 'null,null' : "repeat('" + digit + "',64),'" + verifier(digit) + "'") +
    ',' +
    active +
    ')'
  );
}
const fixture = [
  "insert into public.businesses(id,name) values ('" +
    B +
    "','Tenant A'),('" +
    B2 +
    "','Tenant B');",
  "insert into public.shops(id,name,active) values ('" +
    S +
    "','New shop',true),('" +
    S2 +
    "','Existing shop',true),('" +
    S3 +
    "','Foreign shop',true);",
  "insert into public.business_shops(business_id,shop_id) values ('" +
    B +
    "','" +
    S +
    "'),('" +
    B +
    "','" +
    S2 +
    "'),('" +
    B2 +
    "','" +
    S3 +
    "');",
  'insert into public.business_employees(id,business_id,display_name,role,pin_lookup_hash,pin_hash,active) values ' +
    [
      employee(O, B, 'Owner', 'OWNER', 'a'),
      employee(E, B, 'First Worker', 'STAFF', 'b'),
      employee(M, B, 'Manager', 'MANAGER', 'c'),
      employee(U, B, 'Needs PIN', 'STAFF', null),
      employee(O2, B2, 'Other Owner', 'OWNER', 'd'),
    ].join(',') +
    ';',
  'insert into public.employee_shop_assignments(business_id,employee_id,shop_id) values ' +
    [
      "('" + B + "','" + O + "','" + S + "')",
      "('" + B + "','" + O + "','" + S2 + "')",
      "('" + B + "','" + E + "','" + S + "')",
      "('" + B + "','" + E + "','" + S2 + "')",
      "('" + B + "','" + M + "','" + S + "')",
      "('" + B + "','" + U + "','" + S + "')",
      "('" + B2 + "','" + O2 + "','" + S3 + "')",
    ].join(',') +
    ';',
  "insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect) values ('" +
    B +
    "','" +
    M +
    "','staff.manage','ALLOW');",
  "insert into public.workers(id,shop_id,display_name,pin_hash,pin_lookup_hash,active) values ('" +
    W +
    "','" +
    S2 +
    "','Collision Worker','" +
    verifier('e') +
    "',repeat('b',64),true);",
];
sql(fixture.join('\n'), 'isolated shop/employee fixtures');
deny(call(M, E, S, 'manager-attempt'), 'permission_forbidden');
deny(call(O2, E, S, 'foreign-attempt'), 'shop_outside_business');
deny(call(O, U, S, 'missing-pin'), 'employee_pin_setup_required');
deny(call(O, E, S2, 'pin-collision'), 'pin_already_in_use');
const created = call(O, E, S, 'provision-worker-1');
if (!created.ok || !created.workerId || created.replayed !== false)
  throw new Error('Creation failed: ' + JSON.stringify(created));
const replay = call(O, E, S, 'provision-worker-1');
if (!replay.ok || !replay.replayed || replay.workerId !== created.workerId)
  throw new Error('Idempotent replay failed');
deny(call(O, E, S, 'provision-worker-2'), 'employee_shop_already_linked');
const identity = sql(
  "select count(*)::text || ',' || bool_and(w.pin_hash=e.pin_hash and w.pin_lookup_hash=e.pin_lookup_hash)::text" +
    ' from public.workers w join public.employee_worker_links l on l.worker_id=w.id' +
    " join public.business_employees e on e.id=l.employee_id where w.shop_id='" +
    S +
    "' and e.id='" +
    E +
    "'",
  'atomic worker/link credential verification',
);
if (identity !== '1,true') throw new Error('Created worker/link credentials drifted: ' + identity);
sql(
  "update public.shops set lifecycle_state='SUSPENDED', active=false, temporary_closed=true, online_orders_paused=true where id='" + S + "'",
  'suspended shop fixture',
);
deny(call(O, U, S, 'shop-suspended'), 'shop_not_active');
const auditCount = sql(
  "select count(*) from public.admin_audit_events where action_type='OPERATIONS_WORKER_PROVISIONED'" +
    " and business_id='" +
    B +
    "' and shop_id='" +
    S +
    "'",
  'immutable worker provisioning audit',
);
if (auditCount !== '1') throw new Error('Provisioning audit was not written exactly once');
for (const role of ['anon', 'authenticated']) {
  if (
    sql(
      "select has_function_privilege('" +
        role +
        "','public.provision_employee_operations_worker_v1(uuid,uuid,uuid,text)','EXECUTE')",
      role + ' privileges',
    ) !== 'f'
  )
    throw new Error('Unsafe ' + role + ' RPC execute grant');
}
console.log('First Operations worker provisioning isolated PostgreSQL behavior passed.');

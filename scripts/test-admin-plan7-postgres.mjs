import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Plan 7 PostgreSQL gate requires TEST_DATABASE_URL');
const url = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
  throw new Error('Plan 7 tests refuse to connect to non-loopback PostgreSQL');
}

function psql(args, label, expectFailure = false) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!expectFailure && result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label}: psql exit ${result.status ?? 'unknown'}`);
  }
  if (expectFailure && result.status === 0) {
    throw new Error(`${label}: forbidden mutation unexpectedly succeeded`);
  }
  return result.stdout?.trim() ?? '';
}
function scalar(sql, label) {
  return psql(['-At', '-c', sql], label);
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
    create table storage.buckets(id text primary key, name text not null unique, public boolean not null default false);
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;`,
  ],
  'fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const target = '20261008053000_admin_plan7_finance_schema.sql';
assert(migrations.includes(target), 'Plan 7 migration missing from chain');
for (const migration of migrations.slice(0, migrations.indexOf(target))) {
  psql(['-f', resolve('supabase/migrations', migration)], `prerequisite ${migration}`);
}

const b = '10000000-0000-4000-8000-000000000001';
const s = '11000000-0000-4000-8000-000000000001';
const e = '12000000-0000-4000-8000-000000000001';
const w = '13000000-0000-4000-8000-000000000001';
const d = '14000000-0000-4000-8000-000000000001';
const a = '15000000-0000-4000-8000-000000000001';
const z = '16000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `insert into public.businesses(id, name) values ('${b}', 'Plan 7 business');
    insert into public.shops(id, name, active) values ('${s}', 'Plan 7 shop', true);
    insert into public.business_shops(business_id, shop_id) values ('${b}', '${s}');
    insert into public.business_employees(id, business_id, display_name, role, active)
      values ('${e}', '${b}', 'Owner', 'OWNER', true);
    insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
      values ('${b}', '${e}', '${s}');
    insert into public.workers(id, shop_id, display_name, pin_hash, active)
      values ('${w}', '${s}', 'Cashier', 'not-a-production-pin', true);
    insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id)
      values ('${d}', '${s}', 'OPEN', now(), '${w}');
    insert into public.finance_accounts(id,business_id,shop_id,account_type,name,opening_balance_minor)
      values ('${a}', '${b}', '${s}', 'CASH', 'Real till', 12500);
    insert into public.finance_movements(
      business_id,shop_id,finance_account_id,movement_type,amount_minor,
      command_id,request_fingerprint,actor_employee_id
    ) values ('${b}', '${s}', '${a}', 'STAFF_PAYMENT', -1000, 'pre-plan7',
      repeat('a',64), '${e}');
    insert into public.expenses(
      id,shop_id,business_day_id,kind,description,amount_minor,
      paid_from,created_by_worker_id,created_at,updated_at
    ) values (gen_random_uuid(),'${s}','${d}','MANUAL','Worker expense',100,
      'CASH','${w}',now(),now());`,
  ],
  'legacy Plan 6 fixtures',
);
const before = JSON.parse(
  scalar(
    `select json_build_object(
      'accounts',(select count(*) from public.finance_accounts),
      'movements',(select count(*) from public.finance_movements),
      'expenses',(select count(*) from public.expenses),
      'mappings',(select count(*) from public.payment_method_finance_accounts)
    )::text`,
    'baseline snapshot',
  ),
);
const rpcBefore = scalar(
  "select md5(pg_get_functiondef('public.post_finance_movement_v1(uuid,uuid,uuid,text,bigint,text,text,text,text,text)'::regprocedure))",
  'old RPC definition',
);

psql(['-f', resolve('supabase/migrations', target)], 'Plan 7 forward migration');

const after = JSON.parse(
  scalar(
    `select json_build_object(
      'accounts',(select count(*) from public.finance_accounts),
      'movements',(select count(*) from public.finance_movements),
      'expenses',(select count(*) from public.expenses),
      'mappings',(select count(*) from public.payment_method_finance_accounts)
    )::text`,
    'post-migration legacy snapshot',
  ),
);
assert.deepEqual(after, before, 'migration cannot modify canonical finance/expense history');
assert.equal(
  scalar("select md5(pg_get_functiondef('public.post_finance_movement_v1(uuid,uuid,uuid,text,bigint,text,text,text,text,text)'::regprocedure))", 'RPC compatibility'),
  rpcBefore,
  'STAFF_PAYMENT RPC signature and body must remain unchanged',
);

psql(
  ['-c', `insert into public.finance_movements(
    business_id,shop_id,finance_account_id,movement_type,amount_minor,
    command_id,request_fingerprint,actor_worker_id
  ) values ('${b}','${s}','${a}','SALE',2500,'worker-payment',
    repeat('b',64),'${w}');`],
  'worker-origin SALE',
);
psql(
  ['-c', `insert into public.expenses(
    id,shop_id,business_day_id,kind,description,amount_minor,
    paid_from,created_by_employee_id,created_at,updated_at
  ) values (gen_random_uuid(),'${s}','${d}','MANUAL','Admin expense',
    200,'OTHER','${e}',now(),now());`],
  'Admin expense on canonical table',
);
psql(
  ['-c', `insert into public.finance_movements(
    business_id,shop_id,finance_account_id,movement_type,amount_minor,
    command_id,request_fingerprint,actor_employee_id,actor_worker_id
  ) values ('${b}','${s}','${a}','SALE',100,'fake-double-actor',
    repeat('c',64),'${e}','${w}');`],
  'reject dual actor provenance',
  true,
);

for (const table of [
  'expense_categories',
  'recurring_expense_rules',
  'payment_settlements',
  'end_day_financial_snapshots',
  'cashier_reconciliations',
  'financial_adjustments',
  'saved_report_views',
  'report_targets',
  'daily_owner_summaries',
]) {
  assert.equal(
    scalar(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`, `${table} RLS`),
    't',
    `${table} must enable RLS`,
  );
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      scalar(`select has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE')`, `${table} ${role} privileges`),
      'f',
      `${table} must deny browser roles`,
    );
  }
}

psql(
  ['-c', `insert into public.end_day_financial_snapshots(
    id,business_id,shop_id,business_day_id,snapshot,request_fingerprint,
    finalization_command_id,finalized_by_employee_id
  ) values ('${z}','${b}','${s}','${d}','{}',repeat('d',64),
    'finalize-day','${e}');`],
  'reject OPEN financial finalization',
  true,
);
assert.equal(scalar(`select status from public.business_days where id='${d}'`, 'non-closing X'), 'OPEN');

psql(
  ['-c', `update public.business_days set status='CLOSED',ended_at=now(),
    ended_by_worker_id='${w}' where id='${d}';`],
  'fixture: Operations closes Business Day',
);
psql(
  ['-c', `insert into public.end_day_financial_snapshots(
    id,business_id,shop_id,business_day_id,snapshot,request_fingerprint,
    finalization_command_id,finalized_by_employee_id
  ) values ('${z}','${b}','${s}','${d}','{}',repeat('d',64),
    'finalize-day','${e}');`],
  'CLOSED day financial snapshot',
);
psql(
  ['-c', `update public.end_day_financial_snapshots set snapshot='{"changed":true}' where id='${z}';`],
  'reject immutable Z mutation',
  true,
);
psql(
  ['-c', `insert into public.financial_adjustments(
    business_id,shop_id,snapshot_id,amount_minor,reason,command_id,created_by_employee_id
  ) values ('${b}','${s}','${z}',-300,'Correction','correction-1','${e}');`],
  'append financial adjustment',
);
assert.equal(scalar(`select status from public.business_days where id='${d}'`, 'Operations authority'), 'CLOSED');
console.log('Plan 7 PostgreSQL migration/provenance/closed-day/immutability behavior passed.');

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Admin daily operations PostgreSQL requires TEST_DATABASE_URL.');
const parsed = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname)) throw new Error('Admin daily operations test refuses non-loopback PostgreSQL.');

function psql(args, label, allowFailure = false) {
  const dockerContainer = process.env.TEST_PSQL_DOCKER_CONTAINER;
  let input;
  const normalizedArgs = [...args];
  const fileIndex = normalizedArgs.indexOf('-f');
  if (fileIndex >= 0) {
    input = readFileSync(normalizedArgs[fileIndex + 1], 'utf8');
    normalizedArgs.splice(fileIndex, 2, '-f', '-');
  }
  const command = dockerContainer ? 'docker' : 'psql';
  const commandArgs = dockerContainer
    ? ['exec', '-i', dockerContainer, 'psql', 'postgresql://postgres:postgres@127.0.0.1:5432/tux_daily', '-X', '-v', 'ON_ERROR_STOP=1', ...normalizedArgs]
    : [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...normalizedArgs];
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result;
}
function scalar(sql, label) { return psql(['-At', '-c', sql], label).stdout.trim(); }
function rpc(sql, label) { return JSON.parse(scalar(`select (${sql})::text`, label)); }

psql(['-c', `
drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets(id text primary key,name text not null unique,public boolean not null default false);
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
`], 'fixture reset');

const migrations = readdirSync(resolve('supabase/migrations')).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const target = '20261022111317_admin_daily_operations.sql';
const end = migrations.indexOf(target);
if (end < 0) throw new Error('Admin daily operations migration missing.');
for (const migration of migrations.slice(0, end + 1)) psql(['-f', resolve('supabase/migrations', migration)], migration);

const B1='71000000-0000-4000-8000-000000000001', B2='71000000-0000-4000-8000-000000000002';
const S1='72000000-0000-4000-8000-000000000001', S2='72000000-0000-4000-8000-000000000002', S3='72000000-0000-4000-8000-000000000003';
const A1='73000000-0000-4000-8000-000000000001', A2='73000000-0000-4000-8000-000000000002';
const W1='74000000-0000-4000-8000-000000000001', D1='75000000-0000-4000-8000-000000000001';
const T1='76000000-0000-4000-8000-000000000001', I1='77000000-0000-4000-8000-000000000001';

psql(['-c', `
insert into public.businesses(id,name) values('${B1}','Daily A'),('${B2}','Daily B');
insert into public.shops(id,name,active) values('${S1}','Shop A',true),('${S2}','Shop A no day',true),('${S3}','Shop B',true);
insert into public.business_shops(business_id,shop_id) values('${B1}','${S1}'),('${B1}','${S2}'),('${B2}','${S3}');
insert into public.business_employees(id,business_id,display_name,role,active) values('${A1}','${B1}','Owner A','OWNER',true),('${A2}','${B2}','Owner B','OWNER',true);
insert into public.workers(id,shop_id,display_name,pin_hash,active) values('${W1}','${S1}','Worker','hash',true);
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id) values('${D1}','${S1}','OPEN','2026-10-22T08:00:00Z','${W1}');
insert into public.admin_daily_checklist_templates(id,business_id,shop_id,kind,title,created_by_employee_id) values('${T1}','${B1}','${S1}','OPEN','Opening checklist','${A1}');
insert into public.admin_daily_checklist_items(id,business_id,shop_id,template_id,position,label,required) values('${I1}','${B1}','${S1}','${T1}',0,'Check till',true);
`], 'daily operations fixtures');

const first = rpc(`public.complete_admin_daily_checklist_v1('${A1}','${S1}','${D1}','OPEN','${T1}',1,array['${I1}'::uuid],'complete-1')`, 'complete checklist');
const replay = rpc(`public.complete_admin_daily_checklist_v1('${A1}','${S1}','${D1}','OPEN','${T1}',1,array['${I1}'::uuid],'complete-1')`, 'replay checklist');
if (!first.ok || !replay.ok || replay.replayed !== true) throw new Error('Checklist completion idempotency failed.');
if (scalar(`select count(*) from public.admin_daily_checklist_runs where shop_id='${S1}'`, 'run count') !== '1') throw new Error('Repeated command created a second run.');
psql(['-c', `update public.admin_daily_checklist_items set label='Changed current template' where id='${I1}'`], 'edit current template');
if (scalar(`select label_snapshot from public.admin_daily_checklist_run_items where template_item_id='${I1}'`, 'historic snapshot') !== 'Check till') throw new Error('Template edit rewrote historical snapshot.');

const noDay = rpc(`public.complete_admin_daily_checklist_v1('${A1}','${S2}',gen_random_uuid(),'OPEN','${T1}',1,'{}'::uuid[],'no-day')`, 'missing day');
if (noDay.ok !== false || noDay.code !== 'business_day_required') throw new Error('Missing day produced false completion.');
const crossBusiness = rpc(`public.complete_admin_daily_checklist_v1('${A1}','${S3}','${D1}','OPEN','${T1}',1,'{}'::uuid[],'cross-business')`, 'cross business');
if (crossBusiness.ok !== false || crossBusiness.code !== 'permission_forbidden') throw new Error('Cross-business checklist mutation was not denied.');

const note = rpc(`public.append_admin_manager_log_v1('${A1}','${S1}','Shift handoff complete',null,'note-1')`, 'append note');
const noteReplay = rpc(`public.append_admin_manager_log_v1('${A1}','${S1}','Shift handoff complete',null,'note-1')`, 'replay note');
if (!note.ok || !noteReplay.ok || noteReplay.replayed !== true) throw new Error('Manager note idempotency failed.');
if (scalar(`select count(*) from public.admin_manager_log where shop_id='${S1}'`, 'note count') !== '1') throw new Error('Repeated note created a duplicate.');
const updateDenied = psql(['-c', `set role authenticated; update public.admin_manager_log set note='tampered' where shop_id='${S1}'`], 'deny note update', true);
const deleteDenied = psql(['-c', `set role authenticated; delete from public.admin_manager_log where shop_id='${S1}'`], 'deny note delete', true);
if (updateDenied.status === 0 || deleteDenied.status === 0) throw new Error('Manager log is not append-only for authenticated clients.');
if (scalar(`select has_table_privilege('authenticated','public.admin_manager_log','SELECT')`, 'RLS/grant check') !== 'f') throw new Error('Authenticated role unexpectedly has direct manager-log access.');

console.log('Admin daily operations PostgreSQL isolation, idempotency, history and append-only invariants passed.');

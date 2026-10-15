import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Shop lifecycle approval PostgreSQL skipped: no TEST_DATABASE_URL');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing to execute lifecycle approval test outside isolated PostgreSQL');
}
function sql(query, label = 'SQL') {
  const r = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(label + ': ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}
const rpc = (expr, label) => JSON.parse(sql('select (' + expr + ')::text', label));
function deny(result, code) {
  if (result.ok !== false || result.code !== code) {
    throw new Error('Expected ' + code + ': ' + JSON.stringify(result));
  }
}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade;create schema private;
drop schema if exists auth cascade;create schema auth;
drop schema if exists storage cascade;create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $do$ begin
if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $do$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $do$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $do$;`, 'isolated fixture');
const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((x) => /^\d+_.+\.sql$/.test(x))
  .sort();
const target = '20261015085527_admin_shop_lifecycle_open_request_lock.sql';
const index = migrations.indexOf(target);
if (index < 0) throw new Error('Missing expected shop lifecycle approval SQL migration');
for (const name of migrations.slice(0, index + 1)) {
  const result = spawnSync(
    'psql',
    [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Migration ' + name + ': ' + result.stderr);
}
const B = '91111111-1111-4111-8111-111111111111';
const S = '92222222-2222-4222-8222-222222222222';
const E = '93333333-3333-4333-8333-333333333333';
const A = '93333333-3333-4333-8333-333333333334';
const RULE = '94444444-4444-4444-8444-444444444444';
const CMD = '95555555-5555-4555-8555-555555555555';
sql(`insert into public.businesses(id,name) values ('${B}','Lifecycle tenant');
insert into public.shops(id,name,active,lifecycle_state,lifecycle_revision)
 values ('${S}','Lifecycle target',true,'ACTIVE',1);
insert into public.business_shops(business_id,shop_id) values ('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active)
 values ('${E}','${B}','Owner requester','OWNER',true),
        ('${A}','${B}','Owner reviewer','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
 values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
insert into public.admin_approval_rules(
 id,business_id,shop_id,action_type,requester_permission,approver_permission,
 requires_second_person,threshold_context,active)
 values ('${RULE}','${B}',null,'SHOP_LIFECYCLE_CHANGE',
 'shops.manage','approvals.review',true,'{}'::jsonb,true);`, 'business rule and two real approvers');
// Confirm the public Settings approval-rule mutator accepts this executable
// action and performs the rule CAS as the real BFF does.
const configuredRule = rpc(`public.upsert_admin_approval_rule_v1(
 '${E}'::uuid,'${S}'::uuid,'${RULE}'::uuid,null,
 'SHOP_LIFECYCLE_CHANGE','shops.manage','approvals.review',true,false,
 3600,'{}'::jsonb,true,1)`, 'trusted lifecycle approval Rule upsert');
if (!configuredRule.ok || configuredRule.ruleId !== RULE ||
 configuredRule.editVersion !== 2) {
 throw new Error('Shop lifecycle action not configurable through trusted settings: ' +
   JSON.stringify(configuredRule));
}
const direct = (revision = 1, expected = 'ACTIVE', target = 'SUSPENDED') =>
  `public.update_admin_shop_lifecycle_v1(
    '${E}'::uuid,'${S}'::uuid,${revision},'${expected}','${target}')`;
deny(rpc(direct(), 'cannot bypass configured approval'), 'shop_lifecycle_approval_required');
const initial = sql(`select lifecycle_state||','||lifecycle_revision::text
 from public.shops where id='${S}'`);
if (initial !== 'ACTIVE,1') throw new Error('Direct command modified approved shop');
const payload = {
  shopId: S, expectedLifecycleRevision: 1,
  expectedState: 'ACTIVE', targetState: 'SUSPENDED',
};
const created = rpc(`public.create_admin_approval_request_v1(
  '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
  'SHOP_LIFECYCLE_CHANGE','${CMD}'::uuid,'${JSON.stringify(payload)}'::jsonb,
  'Suspend shop')`, 'create lifecycle approval request');
if (!created.ok || !created.requestId) {
  throw new Error('Lifecycle request was not persisted: ' + JSON.stringify(created));
}
// Disabling an approval Rule cannot unlock an already-open exact lifecycle
// command. The request must be executed or terminally resolved first.
sql(`update public.admin_approval_rules set active=false where id='${RULE}'`,
 'turn off policy after pending request exists');
deny(rpc(direct(),'pending command bypass with disabled rule'),
 'shop_lifecycle_approval_required');
if (sql(`select lifecycle_state||','||lifecycle_revision from public.shops
 where id='${S}'`) !== 'ACTIVE,1') {
  throw new Error('Pending lifecycle action was bypassed after policy disable');
}
sql(`update public.admin_approval_rules set active=true where id='${RULE}'`,
 'restore policy before decision');
const approved = rpc(`public.decide_admin_approval_request_v1(
  '${created.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Operational pause')`,
  'second person approves lifecycle');
if (!approved.ok) throw new Error('Second-person decision rejected: ' + JSON.stringify(approved));
const claims = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('lifecycle-test',now(),10,300) c`));
if (!claims.some((x) => x.approval_request_id === created.requestId)) {
  throw new Error('Approval executor did not claim lifecycle command');
}
const execute = (approver = A, revision = 1, state = 'SUSPENDED') =>
  `public.execute_approved_admin_shop_lifecycle_v1(
  '${created.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,
  '${approver}'::uuid,${revision},'ACTIVE','${state}','${CMD}'::uuid)`;
deny(rpc(execute(E), 'self approval bypass'),
  'approval_shop_lifecycle_payload_or_state_mismatch');
deny(rpc(execute(A, 2), 'tampered CAS revision'),
  'approval_shop_lifecycle_payload_or_state_mismatch');
const executed = rpc(execute(), 'execute approved lifecycle');
if (!executed.ok || executed.lifecycleRevision !== 2) {
  throw new Error('Authorized suspension did not update canonical shop: ' +
    JSON.stringify(executed));
}
const replay = rpc(execute(), 'ambiguous completion exact replay');
if (!replay.ok || replay.lifecycleRevision !== 2 || replay.idempotentReplay !== true) {
  throw new Error('Lifecycle retry double-executed or lost receipt: ' + JSON.stringify(replay));
}
// Simulate the worker committing its separate completion receipt and then
// receiving a duplicate network delivery. Canonical shop effect stays once.
const lifecycleClaim = claims.find((x) => x.approval_request_id === created.requestId);
if (!lifecycleClaim?.claim_token) throw new Error('Claim token absent');
const completion = rpc(`public.complete_admin_approval_execution_v1(
 '${created.requestId}'::uuid,'${lifecycleClaim.claim_token}','EXECUTED',
 null,'{"idempotentReplay":false}'::jsonb,now())`,
 'complete durable shop lifecycle approval');
if (!completion.ok) {
 throw new Error('Approval execution completion was not committed: ' +
   JSON.stringify(completion));
}
const completedReplay = rpc(execute(), 'repeat fully completed approved lifecycle');
if (!completedReplay.ok || completedReplay.idempotentReplay !== true ||
 completedReplay.lifecycleRevision !== 2) {
 throw new Error('Completion replay is not exactly-once: ' +
   JSON.stringify(completedReplay));
}
const after = sql(`select lifecycle_state||','||lifecycle_revision::text||
 ','||temporary_closed::text||','||online_orders_paused::text
 from public.shops where id='${S}'`);
if (after !== 'SUSPENDED,2,true,true') {
  throw new Error('Canonical lifecycle invariant not preserved: ' + after);
}
if (sql(`select count(*) from public.admin_audit_events
 where shop_id='${S}' and action_type='SHOP_LIFECYCLE_APPROVED_APPLIED'`) !== '1') {
  throw new Error('Approved lifecycle audit not exactly once');
}
if (sql(`select count(*) from private.admin_shop_lifecycle_approval_receipts
 where shop_id='${S}'`) !== '1') {
  throw new Error('Lifecycle receipt not durable');
}
deny(rpc(direct(2,'SUSPENDED','ACTIVE'),'reactivation still requires approval'),
  'shop_lifecycle_approval_required');
const CMD2='95555555-5555-4555-8555-555555555556';
const payload2 = {
  shopId: S, expectedLifecycleRevision: 2,
  expectedState: 'SUSPENDED', targetState: 'ACTIVE',
};
const created2 = rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'SHOP_LIFECYCLE_CHANGE','${CMD2}'::uuid,'${JSON.stringify(payload2)}'::jsonb,
 'Reactivate shop')`, 'create stale lifecycle approval');
if (!created2.ok) throw new Error('Stale lifecycle request was not persisted');
const decision2 = rpc(`public.decide_admin_approval_request_v1(
  '${created2.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Reopen')`,
  'second approval');
if (!decision2.ok) throw new Error('Second decision failed');
const claim2 = JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('lifecycle-test',now(),10,300) c`));
if (!claim2.some((x) => x.approval_request_id === created2.requestId)) {
  throw new Error('Stale lifecycle request could not be claimed');
}
// Simulate a legitimately concurrent change in the isolated fixture (not
// through the protected public RPC) to prove the approved command has a
// strict expected-revision fence even after an earlier approval decision.
sql(`update public.shops set lifecycle_state='ACTIVE',lifecycle_revision=3,
 active=true,temporary_closed=true,online_orders_paused=true
 where id='${S}' and lifecycle_state='SUSPENDED' and lifecycle_revision=2`,
 'interleaving revision conflict fixture');
if (sql(`select lifecycle_revision::text from public.shops where id='${S}'`) !== '3') {
  throw new Error('Interleaving change did not establish stale revision');
}
const stale = rpc(`public.execute_approved_admin_shop_lifecycle_v1(
 '${created2.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,
 '${A}'::uuid,2,'SUSPENDED','ACTIVE','${CMD2}'::uuid)`, 'reject stale approval');
deny(stale, 'stale_shop_lifecycle');
if (sql(`select lifecycle_state||','||lifecycle_revision
 from public.shops where id='${S}'`) !== 'ACTIVE,3') {
  throw new Error('Stale approval wrote an extra lifecycle transition');
}
for (const role of ['anon', 'authenticated']) {
  if (sql(`select has_function_privilege('${role}',
  'public.execute_approved_admin_shop_lifecycle_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid)',
  'EXECUTE')`) !== 'f') {
    throw new Error('Direct untrusted execution grant: ' + role);
  }
}
console.log('Shop lifecycle approval PostgreSQL: direct guard, second approver, payload, CAS, replay, audit and permissions passed.');

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Cashier reconciliation approval PostgreSQL skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing cashier approval reset outside isolated loopback PostgreSQL');
}
function sql(query, label = 'SQL') {
  const res = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], {
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(label + ': ' + (res.stderr || res.stdout));
  return res.stdout.trim();
}
const rpc = (command, label) => JSON.parse(sql('select (' + command + ')::text', label));
function denied(outcome, code) {
  if (outcome?.ok !== false || outcome.code !== code) {
    throw new Error('Expected ' + code + ', got ' + JSON.stringify(outcome));
  }
}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $r$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit;end if;
end $r$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $u$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $u$;`,
'reset only CI PostgreSQL');
const target = '20261015201518_admin_finance_cashier_reconciliation_approval.sql';
const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const index = migrations.indexOf(target);
if (index < 0) throw new Error('Missing cashier approved reconciliation SQL');
for (const name of migrations.slice(0, index + 1)) {
  const res = spawnSync(
    'psql',
    [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) throw new Error('Applying ' + name + ': ' + res.stderr);
}
const B = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const E = '33333333-3333-4333-8333-333333333333';
const A = '33333333-3333-4333-8333-333333333334';
const W = '44444444-4444-4444-8444-444444444444';
const D = '55555555-5555-4555-8555-555555555555';
const RULE = '66666666-6666-4666-8666-666666666666';
const CMD = '77777777-7777-4777-8777-777777777777';
const ACMD = '88888888-8888-4888-8888-888888888888';
sql(`
insert into public.businesses(id,name) values ('${B}','Approved cash reconciliation');
insert into public.shops(id,name,active,lifecycle_state)
values ('${S}','Shop',true,'ACTIVE');
insert into public.business_shops(business_id,shop_id) values ('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active)
values ('${E}','${B}','Reconciler','OWNER',true),
       ('${A}','${B}','Reviewer','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
insert into public.workers(id,shop_id,display_name,pin_hash,active)
values ('${W}','${S}','Cashier','fixture-hash',true);
insert into public.business_days(id,shop_id,status,started_at,ended_at,
 started_by_worker_id,ended_by_worker_id)
values ('${D}','${S}','CLOSED',now()-interval '1 day',now(),'${W}','${W}');
insert into public.admin_approval_rules(
id,business_id,shop_id,action_type,requester_permission,approver_permission,
requires_second_person,threshold_context,active)
values ('${RULE}','${B}',null,'FINANCE_CASHIER_RECONCILIATION',
'finance.reconcile','approvals.review',true,'{"minimumMinor":500}'::jsonb,true);
`, 'cashier reconciliation isolated business');
const preview = (amount) => `public.preview_admin_finance_cashier_reconciliation_v1(
 '${E}'::uuid,'${S}'::uuid,'${D}'::uuid,'${W}'::uuid,
 ${amount},'Drawer variance','${CMD}')`;
const report = rpc(preview(500), 'trusted drawer variance preview');
if (!report.ok || report.businessId !== B ||
    !Number.isSafeInteger(report.expectedMinor) ||
    !Number.isSafeInteger(report.varianceMinor)) {
  throw new Error('Cash drawer facts not returned: ' + JSON.stringify(report));
}
const amount = report.expectedMinor + 500;
if (!Number.isSafeInteger(amount) || amount < 0) {
  throw new Error('Unexpected nonnegative amount fixture: ' + amount);
}
const currentPreview = rpc(preview(amount), 'at-threshold trusted variance');
if (!currentPreview.ok || currentPreview.varianceMinor !== 500 ||
    currentPreview.ruleId !== RULE || currentPreview.approvalRequired !== true) {
  throw new Error('Server failed to evaluate trusted threshold: ' +
    JSON.stringify(currentPreview));
}
const direct = (actual = amount, command = CMD) =>
  `public.finance_reconcile_cashier_v1(
 '${E}'::uuid,'${S}'::uuid,'${D}'::uuid,'${W}'::uuid,
 ${actual},'Drawer variance','${command}')`;
denied(rpc(direct(), 'approval requirement direct bypass'),
  'finance_cashier_approval_required');
if (sql(`select count(*) from public.cashier_reconciliations
 where business_day_id='${D}'`) !== '0') {
  throw new Error('High variance drawer posted before approval');
}
const payload = {
  shopId: S, businessDayId: D, cashierWorkerId: W,
  actualMinor: amount, expectedMinor: report.expectedMinor,
  reason: 'Drawer variance', commandId: CMD,
};
const created = rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'FINANCE_CASHIER_RECONCILIATION','${ACMD}'::uuid,
 '${JSON.stringify(payload)}'::jsonb,'Drawer variance')`,
 'durable drawer approval request');
if (!created.ok || !created.requestId) {
  throw new Error('Cannot create cashier reconciliation approval: ' + JSON.stringify(created));
}
sql(`update public.admin_approval_rules set active=false where id='${RULE}'`,
 'simulate approval rule disabled with pending cash command');
denied(rpc(direct(amount + 1), 'altered amount original command still locked'),
  'finance_cashier_approval_required');
denied(rpc(direct(), 'pending exact reconciliation still locked'),
  'finance_cashier_approval_required');
sql(`update public.admin_approval_rules set active=true where id='${RULE}'`,
 'restore approval rule fixture');
const decision = rpc(`public.decide_admin_approval_request_v1(
 '${created.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Reviewed drawer')`,
 'independent cash approver');
if (!decision.ok) throw new Error('Cashier approval decision refused');
const claims = JSON.parse(sql(`
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('cash-reconciliation-worker',now(),10,300) c`));
const claim = claims.find((c) => c.approval_request_id === created.requestId);
if (!claim?.claim_token) throw new Error('Cashier approved execution not claimed');
const approved = (approver = A, expected = report.expectedMinor) =>
 `public.execute_approved_admin_cashier_reconciliation_v1(
 '${created.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
 '${E}'::uuid,'${approver}'::uuid,'${D}'::uuid,'${W}'::uuid,
 ${amount},${expected},'Drawer variance','${CMD}','${ACMD}'::uuid)`;
denied(rpc(approved(E), 'self-approval refused'), 'invalid_approved_cashier_reconciliation');
denied(rpc(approved(A,report.expectedMinor + 1), 'tampered expected drawer amount'),
  'approval_cashier_payload_or_state_mismatch');
const executed = rpc(approved(), 'post approved cashier reconciliation');
if (!executed.ok || !executed.reconciliationId) {
  throw new Error('Approved drawer reconciliation did not post: ' + JSON.stringify(executed));
}
const replay = rpc(approved(), 'same command worker retry');
if (!replay.ok || replay.idempotentReplay !== true ||
    replay.reconciliationId !== executed.reconciliationId) {
  throw new Error('Cashier reconciliation not exactly-once replayable');
}
const complete = rpc(`public.complete_admin_approval_execution_v1(
 '${created.requestId}'::uuid,'${claim.claim_token}','EXECUTED',
 null,'{"idempotentReplay":false}'::jsonb,now())`, 'complete approved command');
if (!complete.ok) throw new Error('Approved cashier work not terminally completed');
const after = rpc(approved(), 'retry after terminal worker completion');
if (!after.ok || after.idempotentReplay !== true) {
  throw new Error('Completed cashier approval duplicate side effect');
}
if (sql(`select count(*) from public.cashier_reconciliations
 where business_day_id='${D}' and cashier_worker_id='${W}'`) !== '1' ||
    sql(`select count(*) from private.admin_finance_cashier_reconciliation_approval_receipts
 where approval_request_id='${created.requestId}'`) !== '1' ||
    sql(`select count(*) from public.admin_audit_events
 where action_type='FINANCE_CASHIER_RECONCILIATION_APPROVED_APPLIED'`) !== '1') {
  throw new Error('Approval produced missing or duplicate reconciliation/audit/receipt');
}
for (const role of ['anon','authenticated']) {
  const allowed = sql(`select has_function_privilege('${role}',
 'public.execute_approved_admin_cashier_reconciliation_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,text,uuid)','EXECUTE')`);
  if (allowed !== 'f') throw new Error('Privileged cashier executor exposed to ' + role);
}
console.log('Cashier reconciliation approval: trusted variance, pending lock, distinct approver, exact CAS, once-only receipt and audit passed');

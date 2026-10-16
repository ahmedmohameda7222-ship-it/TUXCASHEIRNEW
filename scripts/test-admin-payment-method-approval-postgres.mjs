import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Payment method approval PostgreSQL skipped: no TEST_DATABASE_URL');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing payment approval test outside isolated PostgreSQL');
}
function sql(query, label = 'SQL') {
  const r = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(label + ': ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}
const rpc = (expr, label) => JSON.parse(sql('select (' + expr + ')::text', label));
function deny(value, code) {
  if (value.ok !== false || value.code !== code) {
    throw new Error('Expected ' + code + ', got ' + JSON.stringify(value));
  }
}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
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
  .filter((x) => /^\d+_.+\.sql$/.test(x)).sort();
const target = '20261016015709_admin_payment_method_update_approval.sql';
const index = migrations.indexOf(target);
if (index < 0) throw new Error('Missing payment approval migration');
for (const name of migrations.slice(0, index + 1)) {
  const r = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve('supabase/migrations', name)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Migration ' + name + ': ' + r.stderr);
}
const B = '91111111-1111-4111-8111-111111111111';
const S = '92222222-2222-4222-8222-222222222222';
const E = '93333333-3333-4333-8333-333333333333';
const A = '93333333-3333-4333-8333-333333333334';
const RULE = '94444444-4444-4444-8444-444444444444';
const CMD = '95555555-5555-4555-8555-555555555555';
const PM = '96666666-6666-4666-8666-666666666666';
sql(`insert into public.businesses(id,name) values ('${B}','Payment tenant');
insert into public.shops(id,name,active,lifecycle_state,lifecycle_revision)
 values ('${S}','Payment shop',true,'ACTIVE',1);
insert into public.business_shops(business_id,shop_id) values ('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active)
 values ('${E}','${B}','Requester','OWNER',true),
        ('${A}','${B}','Reviewer','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
 values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
insert into public.payment_methods(
 id,shop_id,display_name,logic_type,requires_reconciliation,active,
 sort_order,channel,requires_reference,manual_confirmation_required,refund_allowed)
 values ('${PM}','${S}','Card','CARD',true,true,0,'POS',false,false,true);
insert into public.admin_approval_rules(
 id,business_id,shop_id,action_type,requester_permission,approver_permission,
 requires_second_person,threshold_context,active)
 values ('${RULE}','${B}',null,'SETTINGS_PAYMENT_METHOD_CHANGE',
 'settings.manage','approvals.review',true,'{}'::jsonb,true);`, 'two-person payment fixture');
const before = sql(`select display_name||','||channel||','||edit_version::text
 from public.payment_methods where id='${PM}'`);
const payload = {
  shopId: S, paymentMethodId: PM, displayName: 'Card Updated', active: true,
  sortOrder: 1, channel: 'BOTH', requiresReference: true,
  manualConfirmationRequired: false, refundAllowed: true,
  expectedSettingsVersion: 0, expectedEditVersion: 1,
};
const direct = (label = 'Card Updated', channel = 'BOTH') =>
  `public.update_admin_payment_method_v1(
  '${E}'::uuid,'${S}'::uuid,'${PM}'::uuid,'${label}',
  true,1,'${channel}',true,false,true,0,1)`;
deny(rpc(direct(),'deny configured direct payment edit'), 'payment_method_approval_required');
if (sql(`select display_name||','||channel||','||edit_version::text from public.payment_methods
 where id='${PM}'`) !== before) throw new Error('Direct update mutated payment method');
const configured = rpc(`public.upsert_admin_approval_rule_v1(
 '${E}'::uuid,'${S}'::uuid,'${RULE}'::uuid,null,
 'SETTINGS_PAYMENT_METHOD_CHANGE','settings.manage','approvals.review',
 true,false,3600,'{}'::jsonb,true,1)`, 'update trusted rule');
if (!configured.ok) throw new Error('Rule not configurable: '+JSON.stringify(configured));
const created = rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'SETTINGS_PAYMENT_METHOD_CHANGE','${CMD}'::uuid,'${JSON.stringify(payload)}'::jsonb,
 'Payment policy update')`, 'create pending');
if (!created.ok || !created.requestId) throw new Error('No durable request: '+JSON.stringify(created));
sql(`update public.admin_approval_rules set active=false where id='${RULE}'`, 'disabled rule');
deny(rpc(direct(),'disabled rule pending bypass'),'payment_method_approval_required');
deny(rpc(direct('Tampered','ONLINE'),'changed payload pending bypass'),'payment_method_approval_required');
sql(`update public.admin_approval_rules set active=true where id='${RULE}'`, 'restore rule');
const approved = rpc(`public.decide_admin_approval_request_v1(
 '${created.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Approved')`, 'approve');
if (!approved.ok) throw new Error('Different approver rejected: '+JSON.stringify(approved));
const claims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('payment-test',now(),10,300) c`));
const claim=claims.find((x)=>x.approval_request_id===created.requestId);
if (!claim?.claim_token) throw new Error('No claimed payment approval');
const execute=(approver=A,expectedVersion=1,label='Card Updated') =>
  `public.execute_approved_admin_payment_method_update_v1(
 '${created.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,
 '${approver}'::uuid,'${PM}'::uuid,'${label}',true,1,'BOTH',
 true,false,true,0,${expectedVersion},'${CMD}'::uuid)`;
deny(rpc(execute(E), 'deny self approval'),'approval_payment_payload_or_state_mismatch');
deny(rpc(execute(A,2), 'deny tampered revision'),'approval_payment_payload_or_state_mismatch');
deny(rpc(execute(A,1,'Tampered'), 'deny changed name'),'approval_payment_payload_or_state_mismatch');
const executed=rpc(execute(),'approved payment update');
if (!executed.ok || executed.editVersion!==2) throw new Error('Approved edit not committed: '+JSON.stringify(executed));
const replay=rpc(execute(),'same claimed command replay');
if (!replay.ok || replay.editVersion!==2 || replay.idempotentReplay!==true)
  throw new Error('Missing exactly-once receipt: '+JSON.stringify(replay));
const finished=rpc(`public.complete_admin_approval_execution_v1(
 '${created.requestId}'::uuid,'${claim.claim_token}','EXECUTED',null,'{}'::jsonb,now())`,
 'completion receipt');
if (!finished.ok) throw new Error('Worker completion failed');
const replayAfter=rpc(execute(),'retry completed');
if (!replayAfter.ok || replayAfter.idempotentReplay!==true)
  throw new Error('Completed request is not idempotent');
const after=sql(`select display_name||','||channel||','||edit_version::text from public.payment_methods
 where id='${PM}'`);
if (after!=='Card Updated,BOTH,2') throw new Error('Payment config incorrect: '+after);
if (sql(`select count(*) from private.admin_payment_method_update_approval_receipts
 where payment_method_id='${PM}'`)!=='1') throw new Error('Duplicate or missing receipt');
if (sql(`select count(*) from public.admin_audit_events
 where entity_id='${PM}' and action_type='SETTINGS_PAYMENT_METHOD_APPROVED_APPLIED'`)!=='1')
 throw new Error('Approved edit must audit once');
for (const role of ['anon','authenticated']) {
  if (sql(`select has_function_privilege('${role}',
  'public.execute_approved_admin_payment_method_update_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,boolean,integer,text,boolean,boolean,boolean,bigint,bigint,uuid)',
  'EXECUTE')`)!=='f') throw new Error('Unsafe SQL privilege for '+role);
}
console.log('Payment method approval: policy/direct fence, pending disable lock, distinct approver, exact CAS, once-only receipt and audit passed.');

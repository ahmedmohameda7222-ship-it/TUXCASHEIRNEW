import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Finance snapshot approval PostgreSQL skipped: no TEST_DATABASE_URL');
  process.exit(0);
}
if (!['localhost','127.0.0.1','::1'].includes(new URL(db).hostname)) {
  throw new Error('Refusing non-loopback finance snapshot approval PostgreSQL reset');
}
function sql(query,label='SQL') {
  const p = spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1','-At','-c',query],
    {encoding:'utf8'});
  if(p.status!==0)throw new Error(label+': '+(p.stderr||p.stdout));
  return p.stdout.trim();
}
const rpc = (expression,label) => JSON.parse(sql('select ('+expression+')::text',label));
function deny(result,code) {
  if(result.ok!==false||result.code!==code)
    throw new Error('Expected '+code+', got '+JSON.stringify(result));
}
sql(`drop schema if exists public cascade; create schema public;
drop schema if exists private cascade;create schema private;
drop schema if exists auth cascade;create schema auth;
drop schema if exists storage cascade;create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $roles$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $roles$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $auth$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $auth$;`,
'isolated reset');
const target='20261015101006_admin_finance_snapshot_pending_command_lock.sql';
const migrations=readdirSync(resolve('supabase/migrations'))
  .filter(x=>/^\d+_.+\.sql$/.test(x)).sort();
const index=migrations.indexOf(target);
if(index<0)throw new Error('Missing approved baseline migration '+target);
for(const name of migrations.slice(0,index+1)){
 const r=spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1',
   '-f',resolve('supabase/migrations',name)],{encoding:'utf8'});
 if(r.status!==0)throw new Error(name+': '+r.stderr);
}
const B='81111111-1111-4111-8111-111111111111';
const S='82222222-2222-4222-8222-222222222222';
const E='83333333-3333-4333-8333-333333333333';
const A='83333333-3333-4333-8333-333333333334';
const W='84444444-4444-4444-8444-444444444444';
const DAY='85555555-5555-4555-8555-555555555555';
const SNAP='86666666-6666-4666-8666-666666666666';
const RULE='87777777-7777-4777-8777-777777777777';
const CMD='88888888-8888-4888-8888-888888888888';
sql(`
 insert into public.businesses(id,name) values ('${B}','Finance approval company');
 insert into public.shops(id,name,active,lifecycle_state)
 values ('${S}','Finance approval shop',true,'ACTIVE');
 insert into public.business_shops(business_id,shop_id)
 values ('${B}','${S}');
 insert into public.business_employees(id,business_id,display_name,role,active)
 values ('${E}','${B}','Owner finance requester','OWNER',true),
        ('${A}','${B}','Owner finance reviewer','OWNER',true);
 insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
 values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
 insert into public.workers(id,shop_id,display_name,pin_hash,active)
 values ('${W}','${S}','Closed-day test worker','fixture-only-hash',true);
 insert into public.business_days(
 id,shop_id,status,started_at,started_by_worker_id,ended_at,ended_by_worker_id)
 values ('${DAY}','${S}','CLOSED',
 now()-interval '2 hour','${W}',now()-interval '1 hour','${W}');
 insert into public.end_day_financial_snapshots(
 id,business_id,shop_id,business_day_id,snapshot,request_fingerprint,
 finalization_command_id,finalized_by_employee_id)
 values ('${SNAP}','${B}','${S}','${DAY}','{}'::jsonb,
 repeat('a',64),'z-original','${E}');
 insert into public.admin_approval_rules(
 id,business_id,shop_id,action_type,requester_permission,approver_permission,
 requires_second_person,threshold_context,active)
 values ('${RULE}','${B}',null,'FINANCE_SNAPSHOT_ADJUST',
 'finance.adjust','approvals.review',true,'{"minimumMinor":500}'::jsonb,true);
`, 'two actor isolated frozen finance snapshot fixture');
const direct = (minor,cmd) => `public.finance_adjust_snapshot_v1(
 '${E}'::uuid,'${S}'::uuid,'${SNAP}'::uuid,${minor},
 'Audited correction','${cmd}')`;
const smaller=rpc(direct(499,'below-approval-threshold'),'below threshold direct');
if(!smaller.ok)throw new Error('Below-threshold adjustment must remain allowed');
const trustedPreview=rpc(`public.preview_admin_finance_snapshot_adjustment_v1(
 '${E}'::uuid,'${S}'::uuid,'${SNAP}'::uuid,500,
 'Audited correction','at-threshold-needs-approval')`,
 'trusted preview resolves threshold and snapshot revision');
if(!trustedPreview.ok||!trustedPreview.approvalRequired||
 trustedPreview.ruleId!==RULE||trustedPreview.expectedAdjustmentCount!==1)
 throw new Error('Trusted Finance Snapshot approval preview did not match rule and revision');
deny(rpc(direct(500,'at-threshold-needs-approval'),'guard mandatory threshold'),
 'finance_snapshot_approval_required');
if(sql(`select count(*) from public.financial_adjustments where amount_minor=500`) !== '0')
 throw new Error('Protected direct adjustment wrote ledger rows before approval');
const payload={
 shopId:S,snapshotId:SNAP,amountMinor:500,reason:'Audited correction',
 commandId:'at-threshold-needs-approval',expectedAdjustmentCount:1
};
const pending=rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'FINANCE_SNAPSHOT_ADJUST','${CMD}'::uuid,
 '${JSON.stringify(payload)}'::jsonb,'Audited correction')`,
 'open an approval for the exact adjustment');
if(!pending.ok || !pending.requestId)
 throw new Error('Could not open approval: '+JSON.stringify(pending));
sql(`update public.admin_approval_rules set active=false where id='${RULE}'`,
 'disable rule after open approval');
deny(rpc(direct(500,'at-threshold-needs-approval'),
 'pending approval cannot be bypassed by disabling policy'),
 'finance_snapshot_approval_required');
// A pending approval owns its ORIGINAL command identity. Disabling a rule
// must not allow a changed amount to post with that pending command ID.
deny(
  rpc(direct(501,'at-threshold-needs-approval'),
    'tampered amount cannot bypass existing pending approval after rule disable'),
  'finance_snapshot_approval_required',
);
if (sql(`select count(*) from public.financial_adjustments
 where command_id='at-threshold-needs-approval'`) !== '0') {
  throw new Error('Tampered pending Finance command modified the ledger');
}
sql(`update public.admin_approval_rules set active=true where id='${RULE}'`,
 'restore finance approval threshold');
const approved=rpc(`public.decide_admin_approval_request_v1(
 '${pending.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Reviewed immutable Z')`,
 'distinct approver');
if(!approved.ok)throw new Error('Second-person approval did not persist');
const claims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('finance-review',now(),10,300) c`));
if(!claims.some(x=>x.approval_request_id===pending.requestId))
 throw new Error('Approved finance adjustment was not claimed by worker');
const executor=(approver=A,expectedCount=1)=>`
 public.execute_approved_admin_finance_snapshot_adjustment_v1(
 '${pending.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
 '${E}'::uuid,'${approver}'::uuid,'${SNAP}'::uuid,
 500,'Audited correction','at-threshold-needs-approval',${expectedCount},
 '${CMD}'::uuid)`;
deny(rpc(executor(E), 'requester cannot approve their own finance effect'),
 'approval_finance_snapshot_payload_or_state_mismatch');
deny(rpc(executor(A,2), 'worker may not tamper with count'),
 'approval_finance_snapshot_payload_or_state_mismatch');
const result=rpc(executor(), 'trusted finance snapshot approved execution');
if(!result.ok||!result.adjustmentId||result.replayed)
 throw new Error('Approved finance correction failed: '+JSON.stringify(result));
const financeClaim=claims.find(x=>x.approval_request_id===pending.requestId);
if(!financeClaim?.claim_token)throw new Error('Claim receipt token missing');
const replay=rpc(executor(), 'replay after ambiguous worker completion');
if(!replay.ok||replay.adjustmentId!==result.adjustmentId||
 replay.idempotentReplay!==true)throw new Error('Finance correction duplicated on replay');
const completed=rpc(`public.complete_admin_approval_execution_v1(
 '${pending.requestId}'::uuid,'${financeClaim.claim_token}','EXECUTED',
 null,'{"idempotentReplay":false}'::jsonb,now())`,
 'persist finance approval worker completion');
if(!completed.ok)throw new Error('Finance worker completion was not durable');
const completedReplay=rpc(executor(), 'replay after durable worker completion');
if(!completedReplay.ok||completedReplay.adjustmentId!==result.adjustmentId||
 completedReplay.idempotentReplay!==true)
 throw new Error('Completed Finance approval replay posted a duplicate correction');

// Approval is bound to the observed immutable-snapshot adjustment count.
// A below-threshold correction can still advance that count; stale approved
// amounts must not execute against a newer ledger state.
const CMD2='88888888-8888-4888-8888-888888888889';
const countBefore=Number(sql(`select count(*) from public.financial_adjustments
 where snapshot_id='${SNAP}'`));
const stalePayload={
 shopId:S,snapshotId:SNAP,amountMinor:700,reason:'Stale adjustment',
 commandId:'stale-finance-correction',expectedAdjustmentCount:countBefore
};
const requested2=rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'FINANCE_SNAPSHOT_ADJUST','${CMD2}'::uuid,
 '${JSON.stringify(stalePayload)}'::jsonb,'Stale correction')`,
 'create revision-bound approved correction');
if(!requested2.ok||!requested2.requestId)throw new Error('Cannot create stale correction');
const decided2=rpc(`public.decide_admin_approval_request_v1(
 '${requested2.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Reviewed')`,
 'second person approves stale correction');
if(!decided2.ok)throw new Error('Second finance approval rejected');
const claims2=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('finance-review',now(),10,300) c`));
if(!claims2.some(x=>x.approval_request_id===requested2.requestId))
 throw new Error('Second adjustment not claimed');
const intervening=rpc(direct(100,'unrelated-below-threshold'),
 'allow an unrelated below-threshold adjustment');
if(!intervening.ok)throw new Error('Legitimate below-threshold correction blocked');
const staleResult=rpc(`public.execute_approved_admin_finance_snapshot_adjustment_v1(
 '${requested2.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
 '${E}'::uuid,'${A}'::uuid,'${SNAP}'::uuid,
 700,'Stale adjustment','stale-finance-correction',${countBefore},
 '${CMD2}'::uuid)`, 'reject stale finance snapshot adjustment');
deny(staleResult,'stale_finance_snapshot_adjustment');
if(sql(`select count(*) from public.financial_adjustments
 where snapshot_id='${SNAP}' and amount_minor=700`) !== '0')
 throw new Error('Stale approved correction mutated the ledger');

if(sql(`select count(*) from public.financial_adjustments
 where snapshot_id='${SNAP}' and amount_minor=500`) !== '1')
 throw new Error('Approved adjustment not exactly once');
if(sql(`select snapshot::text from public.end_day_financial_snapshots
 where id='${SNAP}'`) !== '{}')throw new Error('Z snapshot was rewritten');
for(const role of ['anon','authenticated']){
 if(sql(`select has_function_privilege('${role}',
 'public.execute_approved_admin_finance_snapshot_adjustment_v1(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,uuid)',
 'EXECUTE')`)!=='f')throw new Error('Finance approved RPC exposed to '+role);
}
console.log('Finance snapshot: trusted threshold, pending lock, second approver, CAS and once-only ledger passed.');

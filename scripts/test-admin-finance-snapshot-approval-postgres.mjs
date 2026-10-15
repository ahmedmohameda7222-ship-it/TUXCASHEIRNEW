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
const target='20261015085527_admin_shop_lifecycle_open_request_lock.sql';
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
const replay=rpc(executor(), 'replay after ambiguous worker completion');
if(!replay.ok||replay.adjustmentId!==result.adjustmentId||
 replay.idempotentReplay!==true)throw new Error('Finance correction duplicated on replay');
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

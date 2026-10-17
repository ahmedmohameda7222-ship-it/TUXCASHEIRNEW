import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db=process.env.TEST_DATABASE_URL;
if(!db){console.log('Owner withdrawal approval PostgreSQL skipped: missing TEST_DATABASE_URL');process.exit(0);}
if(!['localhost','127.0.0.1','::1'].includes(new URL(db).hostname))
 throw new Error('Refusing to run destructive fixtures on a non-loopback database');
function sql(query,label='SQL'){
 const x=spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1','-At','-c',query],{encoding:'utf8'});
 if(x.status!==0)throw new Error(label+': '+(x.stderr||x.stdout));
 return x.stdout.trim();
}
function rpc(expr,label){return JSON.parse(sql('select ('+expr+')::text',label));}
function denied(result,code){
 if(result.ok!==false||result.code!==code)
 throw new Error('Expected '+code+', got '+JSON.stringify(result));
}
sql(`drop schema if exists public cascade;create schema public;
drop schema if exists private cascade;create schema private;
drop schema if exists auth cascade;create schema auth;
drop schema if exists storage cascade;create schema storage;
create table storage.buckets(id text primary key,name text unique not null,public boolean not null default false);
do $r$ begin
if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit;end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit;end if;
if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit;end if;
end $r$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $u$
select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $u$;`,'loopback reset');
const target='20261015192234_admin_finance_owner_withdrawal_second_person_approval.sql';
const migrations=readdirSync(resolve('supabase/migrations')).filter(x=>/^\d+_.+\.sql$/.test(x)).sort();
const end=migrations.indexOf(target);if(end<0)throw new Error('Missing approved withdrawal migration');
for(const name of migrations.slice(0,end+1)){
 const r=spawnSync('psql',[db,'-X','-v','ON_ERROR_STOP=1','-f',resolve('supabase/migrations',name)],{encoding:'utf8'});
 if(r.status!==0)throw new Error(name+': '+(r.stderr||r.stdout));
}
const B='a1111111-1111-4111-8111-111111111111';
const S='a2222222-2222-4222-8222-222222222222';
const E='a3333333-3333-4333-8333-333333333333';
const A='a3333333-3333-4333-8333-333333333334';
const F='a4444444-4444-4444-8444-444444444444';
const RULE='a5555555-5555-4555-8555-555555555555';
const CMD='a6666666-6666-4666-8666-666666666666';
const ACMD='a7777777-7777-4777-8777-777777777777';
sql(`
insert into public.businesses(id,name) values ('${B}','Withdrawal approval business');
insert into public.shops(id,name,active,lifecycle_state) values ('${S}','Withdrawal test shop',true,'ACTIVE');
insert into public.business_shops(business_id,shop_id) values ('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active)
values ('${E}','Requester Owner','Owner','OWNER',true);` .replace("'Requester Owner','Owner'","'"+B+"','Requester Owner'"),
'owner test fixture');
sql(`insert into public.business_employees(id,business_id,display_name,role,active)
 values ('${A}','${B}','Independent Owner','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
 values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
insert into public.finance_accounts(id,business_id,shop_id,account_type,name,active,opening_balance_minor)
 values ('${F}','${B}','${S}','CASH','Shop treasury',true,500000);
insert into public.admin_approval_rules(id,business_id,shop_id,action_type,requester_permission,
 approver_permission,requires_second_person,threshold_context,active)
 values ('${RULE}','${B}',null,'FINANCE_OWNER_WITHDRAWAL','finance.adjust',
 'approvals.review',true,'{"minimumMinor":500}'::jsonb,true);`,'owner finance rule fixture');
const withdraw=(amount,command=CMD,reason='Owner draw')=>`public.execute_finance_management_v1(
 '${E}'::uuid,'${S}'::uuid,'OWNER_WITHDRAWAL',
 jsonb_build_object('fromAccountId','${F}'::uuid,
 'amountMinor',${amount},'reason','${reason}'),'${command}')`;
const smaller=rpc(withdraw(499,'below-withdrawal-threshold'),'below-threshold withdrawal');
if(!smaller.ok)throw new Error('Below-threshold owner withdrawal rejected');
const preview=rpc(`public.preview_admin_finance_owner_withdrawal_v1(
 '${E}'::uuid,'${S}'::uuid,'${F}'::uuid,500,'Owner draw','${CMD}')`,
 'trusted owner withdrawal approval preview');
if(!preview.ok||preview.businessId!==B||preview.approvalRequired!==true||
 preview.ruleId!==RULE)throw new Error('Trusted owner withdrawal threshold not resolved');
denied(rpc(withdraw(500),'at-threshold withdrawal must be approved'),
 'finance_owner_withdrawal_approval_required');
if(sql(`select count(*) from public.finance_movements where command_id='plan7:${CMD}'`)!=='0')
 throw new Error('Withdrawal posted before second approval');
const payload={shopId:S,accountId:F,amountMinor:500,reason:'Owner draw',commandId:CMD};
const req=rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RULE}'::uuid,
 'FINANCE_OWNER_WITHDRAWAL','${ACMD}'::uuid,
 '${JSON.stringify(payload)}'::jsonb,'Owner draw')`,
 'durable distinct-person withdrawal intent');
if(!req.ok||!req.requestId)throw new Error('Could not create owner withdrawal request');
sql(`update public.admin_approval_rules set active=false where id='${RULE}'`,
 'simulate rule disabled after an open request');
denied(rpc(withdraw(501),'modified amount same pending command id'),
 'finance_owner_withdrawal_approval_required');
denied(rpc(withdraw(500),'exact pending command rule disabled'),
 'finance_owner_withdrawal_approval_required');
if(sql(`select count(*) from public.finance_movements where command_id='plan7:${CMD}'`)!=='0')
 throw new Error('Pending owner withdrawal command bypass posted a movement');
sql(`update public.admin_approval_rules set active=true where id='${RULE}'`,
 'restore withdrawal policy');
const decision=rpc(`public.decide_admin_approval_request_v1(
 '${req.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Reviewed withdrawal')`,
 'independent approval');
if(!decision.ok)throw new Error('Distinct-person approval denied');
const claims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('owner-withdrawal-worker',now(),10,300) c`));
const claim=claims.find(x=>x.approval_request_id===req.requestId);
if(!claim?.claim_token)throw new Error('Approved owner withdrawal never claimed');
const exec=(approver=A,amount=500)=>`public.execute_approved_admin_owner_withdrawal_v1(
 '${req.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
 '${E}'::uuid,'${approver}'::uuid,'${F}'::uuid,
 ${amount},'Owner draw','${CMD}','${ACMD}'::uuid)`;
denied(rpc(exec(E),'self approval denial'),'invalid_approved_owner_withdrawal');
denied(rpc(exec(A,600),'tampered approved amount'),'approval_owner_withdrawal_payload_or_state_mismatch');
const executed=rpc(exec(),'approved owner withdrawal');
if(!executed.ok||executed.commandId!==CMD)throw new Error('Approved owner withdrawal did not post');
const replay=rpc(exec(),'worker retry before completion');
if(!replay.ok||replay.idempotentReplay!==true)throw new Error('Approved owner withdrawal replay duplicated');
const completed=rpc(`public.complete_admin_approval_execution_v1(
 '${req.requestId}'::uuid,'${claim.claim_token}','EXECUTED',
 null,'{"idempotentReplay":false}'::jsonb,now())`,'worker completion');
if(!completed.ok)throw new Error('Approval execution did not complete');
const after=rpc(exec(),'worker retry after completion');
if(!after.ok||after.idempotentReplay!==true)throw new Error('Completion replay double posted');
if(sql(`select count(*) from public.finance_movements where command_id='plan7:${CMD}'`)!=='1')
 throw new Error('Multiple owner withdrawal ledger effects');
if(sql(`select amount_minor::text from public.finance_movements
 where command_id='plan7:${CMD}'`)!=='-500')throw new Error('Owner withdrawal sign incorrect');
if(sql(`select count(*) from private.admin_finance_owner_withdrawal_approval_receipts
 where approval_request_id='${req.requestId}'`)!=='1')
 throw new Error('Owner withdrawal replay receipt missing');
if(sql(`select count(*) from public.admin_audit_events where shop_id='${S}'
 and action_type='FINANCE_OWNER_WITHDRAWAL_APPROVED_APPLIED'`)!=='1')
 throw new Error('Owner withdrawal approval audit not exactly once');
for(const role of ['anon','authenticated']){
 const g=sql(`select has_function_privilege('${role}',
 'public.execute_approved_admin_owner_withdrawal_v1(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,uuid)','EXECUTE')`);
 if(g!=='f')throw new Error('Unsafe owner withdrawal grant to '+role);
}
console.log('Owner withdrawal approval: threshold, pending command fencing, claim, distinct actor, replay, ledger and audit passed');

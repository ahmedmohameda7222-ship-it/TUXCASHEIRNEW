import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const targetMigration = '20260910200000_admin_workforce.sql';
if (!existsSync(resolve('supabase/migrations', targetMigration))) {
  throw new Error('Admin Plan 6 Workforce migration missing from repository chain.');
}
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Admin Workforce PostgreSQL behavior skipped without TEST_DATABASE_URL.');
  process.exit(0);
}
const url = new URL(databaseUrl);
if (!new Set(['127.0.0.1','localhost','::1']).has(url.hostname)) {
  throw new Error('Admin Workforce PostgreSQL test refuses non-loopback PostgreSQL.');
}
function psql(args,label,{allowFailure=false}={}) {
  const r=spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if (r.status!==0 && !allowFailure) {
    process.stderr.write(r.stdout??''); process.stderr.write(r.stderr??'');
    throw new Error(`${label} failed with exit code ${r.status??'unknown'}`);
  }
  return r;
}
function scalar(sql,label){ return psql(['-At','-c',sql],label).stdout.trim(); }
function rpc(sql,label){ return JSON.parse(scalar(`select (${sql})::text`,label)); }
function concurrentRpc(sql) {
  return new Promise((resolvePromise,reject)=>{
    const child=spawn('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-At','-c',`select (${sql})::text`],{stdio:['ignore','pipe','pipe']});
    let out='',err=''; child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>err+=d);
    child.on('close',code=>code===0?resolvePromise(JSON.parse(out.trim())):reject(new Error(err||`psql exit ${code}`)));
  });
}

psql(['-c',`
drop schema if exists public cascade; create schema public;
drop schema if exists private cascade; create schema private;
drop schema if exists auth cascade; create schema auth;
drop schema if exists storage cascade; create schema storage;
create table storage.buckets (id text primary key,name text not null unique,public boolean not null default false);
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated noinherit; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role noinherit; end if;
end $$;
grant usage on schema public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
`],'Workforce fixture reset');

const migrations=readdirSync(resolve('supabase/migrations')).filter(n=>/^\d+_.+\.sql$/.test(n)).sort();
const idx=migrations.indexOf(targetMigration); if(idx<0) throw new Error('Workforce migration missing');
for(const m of migrations.slice(0,idx+1)) psql(['-f',resolve('supabase/migrations',m)],m);

const B1='20000000-0000-4000-8000-000000000001';
const B2='20000000-0000-4000-8000-000000000002';
const S1='21000000-0000-4000-8000-000000000001';
const S2='21000000-0000-4000-8000-000000000002';
const S3='21000000-0000-4000-8000-000000000003';
const A='22000000-0000-4000-8000-000000000001';
const E='22000000-0000-4000-8000-000000000002';
const E2='22000000-0000-4000-8000-000000000003';
const W='23000000-0000-4000-8000-000000000001';
const W2='23000000-0000-4000-8000-000000000002';
const W3='23000000-0000-4000-8000-000000000003';
const DAY='24000000-0000-4000-8000-000000000001';
const SESSION='25000000-0000-4000-8000-000000000001';
const ACCOUNT='26000000-0000-4000-8000-000000000001';
const INACTIVE='26000000-0000-4000-8000-000000000002';
const WRONG='26000000-0000-4000-8000-000000000003';

psql(['-c',`
insert into public.businesses(id,name) values ('${B1}','Workforce A'),('${B2}','Workforce B');
insert into public.shops(id,name,active) values ('${S1}','Shop 1',true),('${S2}','Shop 2',true),('${S3}','Shop 3',true);
insert into public.business_shops(business_id,shop_id) values ('${B1}','${S1}'),('${B1}','${S2}'),('${B2}','${S3}');
insert into public.business_employees(id,business_id,display_name,role,pin_lookup_hash,pin_hash,active)
values
 ('${A}','${B1}','Owner','OWNER',repeat('a',64),'pbkdf2-sha256$210000$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',true),
 ('${E}','${B1}','Employee','STAFF',repeat('b',64),'pbkdf2-sha256$210000$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',true),
 ('${E2}','${B1}','Employee 2','STAFF',repeat('c',64),'pbkdf2-sha256$210000$cccccccccccccccccccccccccccccccc$cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id) values
 ('${B1}','${A}','${S1}'),('${B1}','${A}','${S2}'),('${B1}','${E2}','${S1}');
insert into public.admin_employee_permissions(business_id,employee_id,permission_key,effect)
values ('${B1}','${E2}','staff.manage','ALLOW');
insert into public.workers(id,shop_id,display_name,pin_hash,active,pin_lookup_hash)
values
 ('${W}','${S1}','Linked Worker','pbkdf2-sha256$210000$dddddddddddddddddddddddddddddddd$dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',true,repeat('d',64)),
 ('${W2}','${S2}','Other Worker','pbkdf2-sha256$210000$eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee$eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',true,repeat('e',64)),
 ('${W3}','${S1}','Collision Worker','pbkdf2-sha256$210000$ffffffffffffffffffffffffffffffff$ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',true,repeat('f',64));
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id,last_allocated_display_order_no)
values ('${DAY}','${S1}','OPEN','2026-09-20T06:00:00Z','${W}',0);
insert into public.worker_sessions(id,shop_id,business_day_id,worker_id,started_at,ended_at)
values ('${SESSION}','${S1}','${DAY}','${W}','2026-09-20T07:00:00Z','2026-09-20T15:00:00Z');
insert into public.finance_accounts(id,business_id,shop_id,account_type,name,active,opening_balance_minor)
values
 ('${ACCOUNT}','${B1}','${S1}','CASH','Payroll Cash',true,0),
 ('${INACTIVE}','${B1}','${S1}','BANK','Inactive',false,0),
 ('${WRONG}','${B1}','${S2}','CASH','Wrong Shop',true,0);
`],'Workforce fixtures');

const assign1=rpc(`public.assign_employee_to_shop_v1('${A}','${E}','${S1}','assign-e-s1')`,'assign shop 1');
const assign1Replay=rpc(`public.assign_employee_to_shop_v1('${A}','${E}','${S1}','assign-e-s1')`,'replay assignment');
const assign2=rpc(`public.assign_employee_to_shop_v1('${A}','${E}','${S2}','assign-e-s2')`,'assign shop 2');
if(!assign1.ok||!assign1Replay.replayed||!assign2.ok) throw new Error('multi-shop assignment/idempotency failed');

const cross=rpc(`public.assign_employee_to_shop_v1('${A}','${E}','${S3}','assign-cross')`,'reject cross business');
if(cross.ok!==false||cross.code!=='shop_outside_business') throw new Error(`cross-business assignment accepted: ${JSON.stringify(cross)}`);

const permissionVersion=Number(scalar(`select profile_version from public.business_employees where id='${E}'`,'permission version'));
const permissionSet=rpc(
  `public.set_employee_permission_v1('${A}','${E}','${S1}',${permissionVersion},'staff.view','DENY','permission-e-1')`,
  'set employee permission'
);
if(!permissionSet.ok) throw new Error(`permission update failed: ${JSON.stringify(permissionSet)}`);
const permissionStale=rpc(
  `public.set_employee_permission_v1('${A}','${E}','${S1}',${permissionVersion},'staff.view','ALLOW','permission-e-stale')`,
  'reject stale employee permission'
);
if(permissionStale.ok!==false||permissionStale.code!=='stale_employee') {
  throw new Error(`stale permission update accepted: ${JSON.stringify(permissionStale)}`);
}

const createOwnerEscalation=rpc(
  `public.create_employee_v1('${E2}','${S1}','Forbidden Owner',null,null,null,'OWNER','create-owner-escalation')`,
  'reject OWNER creation escalation'
);
if(createOwnerEscalation.ok!==false||createOwnerEscalation.code!=='role_escalation_forbidden') {
  throw new Error(`shop-scoped staff manager created OWNER: ${JSON.stringify(createOwnerEscalation)}`);
}

const escalationVersion=Number(scalar(`select profile_version from public.business_employees where id='${E}'`,'role escalation version'));
const roleEscalation=rpc(
  `public.set_employee_role_v1('${E2}','${E}','${S1}',${escalationVersion},'OWNER','role-escalation')`,
  'reject role escalation'
);
if(roleEscalation.ok!==false||roleEscalation.code!=='role_escalation_forbidden') {
  throw new Error(`shop-scoped staff manager promoted OWNER: ${JSON.stringify(roleEscalation)}`);
}
const permissionEscalation=rpc(
  `public.set_employee_permission_v1('${E2}','${E}','${S1}',${escalationVersion},'finance.adjust','ALLOW','permission-escalation')`,
  'reject permission escalation'
);
if(permissionEscalation.ok!==false||permissionEscalation.code!=='permission_escalation_forbidden') {
  throw new Error(`shop-scoped staff manager granted advanced permission: ${JSON.stringify(permissionEscalation)}`);
}

const ambiguousBefore=Number(scalar(`select count(*) from public.employee_worker_links where employee_id='${E}'`,'ambiguous mapping count'));
if(ambiguousBefore!==0) throw new Error('ambiguous worker identity was auto-linked');

const link=rpc(`public.link_employee_worker_v1('${A}','${E}','${S1}','${W}','link-e-w')`,'link worker');
if(!link.ok) throw new Error(`worker link failed: ${JSON.stringify(link)}`);
const crossWorker=rpc(`public.link_employee_worker_v1('${A}','${E}','${S1}','${W2}','link-cross-worker')`,'reject cross-shop worker');
if(crossWorker.ok!==false||crossWorker.code!=='worker_shop_mismatch') throw new Error(`cross-shop worker linked: ${JSON.stringify(crossWorker)}`);
rpc(`public.assign_employee_to_shop_v1('${A}','${E2}','${S1}','assign-e2-s1')`,'assign employee 2');
const duplicateWorker=rpc(`public.link_employee_worker_v1('${A}','${E2}','${S1}','${W}','link-duplicate-worker')`,'reject duplicate worker');
if(duplicateWorker.ok!==false||duplicateWorker.code!=='worker_already_linked') throw new Error(`worker linked twice: ${JSON.stringify(duplicateWorker)}`);

const projection1=rpc(`public.project_worker_session_attendance_v1('${SESSION}')`,'project attendance');
const projection2=rpc(`public.project_worker_session_attendance_v1('${SESSION}')`,'replay attendance projection');
if(!projection1.ok||!projection2.ok) throw new Error('attendance projection failed');
const eventCount=Number(scalar(`select count(*) from public.attendance_events where worker_session_id='${SESSION}'`,'attendance count'));
if(eventCount!==2) throw new Error(`attendance projection duplicated: ${eventCount}`);
const startEvent=scalar(`select id from public.attendance_events where worker_session_id='${SESSION}' and event_type='SESSION_START'`,'start event');
const original=scalar(`select occurred_at::text from public.attendance_events where id='${startEvent}'`,'original time');
const correction=rpc(`public.correct_attendance_v1('${A}','${startEvent}','2026-09-20T07:05:00Z','Manager correction','attendance-correct-1')`,'correct attendance');
if(!correction.ok) throw new Error(`correction failed: ${JSON.stringify(correction)}`);
const afterOriginal=scalar(`select occurred_at::text from public.attendance_events where id='${startEvent}'`,'original after correction');
if(afterOriginal!==original) throw new Error('attendance original was mutated');

const badLeave=rpc(`public.create_leave_request_v1('${A}','${E}','${S1}','VACATION','2026-10-10','2026-10-01',null,'leave-bad')`,'invalid leave');
if(badLeave.ok!==false||badLeave.code!=='invalid_leave_range') throw new Error(`invalid leave accepted: ${JSON.stringify(badLeave)}`);

const shift=rpc(`public.create_employee_shift_v1('${A}','${E}','${S1}','2026-10-01T08:00:00Z','2026-10-01T16:00:00Z',30,'shift-create-1')`,'create shift');
if(!shift.ok) throw new Error(`shift create failed: ${JSON.stringify(shift)}`);
const shifted=rpc(`public.update_employee_shift_v1('${A}','${shift.shiftId}',1,'2026-10-01T09:00:00Z','2026-10-01T17:00:00Z',30,'shift-update-1')`,'update shift');
if(!shifted.ok||Number(shifted.version)!==2) throw new Error('shift update failed');
const stale=rpc(`public.update_employee_shift_v1('${A}','${shift.shiftId}',1,'2026-10-01T10:00:00Z','2026-10-01T18:00:00Z',30,'shift-update-stale')`,'stale shift');
if(stale.ok!==false||stale.code!=='stale_shift') throw new Error(`stale shift overwrite accepted: ${JSON.stringify(stale)}`);

for (const [account,code,cmd] of [
 [INACTIVE,'finance_account_inactive','pay-inactive'],
 [WRONG,'finance_account_shop_forbidden','pay-wrong-shop'],
]) {
 const r=rpc(`public.record_staff_payment_v1('${A}','${E}','${S1}','2026-09-01','2026-09-30',10000,9000,'${account}','2026-10-01',null,null,'${cmd}')`,'invalid staff payment');
 if(r.ok!==false||r.code!==code) throw new Error(`invalid account accepted: ${JSON.stringify(r)}`);
}
const paymentSql=`public.record_staff_payment_v1('${A}','${E}','${S1}','2026-09-01','2026-09-30',10000,9000,'${ACCOUNT}','2026-10-01','September','PAY-SEP','pay-ok-1')`;
const pay1=rpc(paymentSql,'staff payment');
const payReplay=rpc(paymentSql,'staff payment replay');
if(!pay1.ok||!payReplay.replayed||payReplay.staffPaymentRecordId!==pay1.staffPaymentRecordId) throw new Error('staff payment replay failed');
const triple=JSON.parse(scalar(`select jsonb_build_object(
 'payments',(select count(*) from public.staff_payment_records where command_id='pay-ok-1'),
 'movements',(select count(*) from public.finance_movements where command_id='pay-ok-1' and movement_type='STAFF_PAYMENT'),
 'expenses',(select count(*) from public.staff_payment_expense_events where command_id='pay-ok-1')
)::text`,'triple count'));
if(Number(triple.payments)!==1||Number(triple.movements)!==1||Number(triple.expenses)!==1) throw new Error(`staff payment triple mismatch: ${JSON.stringify(triple)}`);
const payConflict=rpc(`public.record_staff_payment_v1('${A}','${E}','${S1}','2026-09-01','2026-09-30',10000,8000,'${ACCOUNT}','2026-10-01','September','PAY-SEP','pay-ok-1')`,'changed staff payment');
if(payConflict.ok!==false||payConflict.code!=='staff_payment_command_conflict') throw new Error('staff payment changed payload replayed');

const concurrentSql=`public.record_staff_payment_v1('${A}','${E}','${S1}','2026-10-01','2026-10-31',12000,11000,'${ACCOUNT}','2026-11-01',null,null,'pay-concurrent-1')`;
const [ca,cb]=await Promise.all([concurrentRpc(concurrentSql),concurrentRpc(concurrentSql)]);
if(!ca.ok||!cb.ok||!(ca.replayed||cb.replayed)) throw new Error(`concurrent replay failed: ${JSON.stringify([ca,cb])}`);
const concurrentCount=Number(scalar(`select count(*) from public.staff_payment_records where command_id='pay-concurrent-1'`,'concurrent count'));
if(concurrentCount!==1) throw new Error('concurrent staff payment double-posted');

const oldEmployeeHash=scalar(`select pin_hash from public.business_employees where id='${E}'`,'old employee PIN');
const oldWorkerHash=scalar(`select pin_hash from public.workers where id='${W}'`,'old worker PIN');
const collisionRef=rpc(
 `public.stage_employee_pin_change_v1('${A}','${E}',array['${S1}'::uuid],'pbkdf2-sha256$210000$11111111111111111111111111111111$1111111111111111111111111111111111111111111111111111111111111111',repeat('f',64),(select credential_version from public.business_employees where id='${E}'),null,now()+interval '1 hour','27000000-0000-4000-8000-000000000001')`,
 'stage colliding PIN'
);
if(!collisionRef.ok) throw new Error(`stage PIN failed: ${JSON.stringify(collisionRef)}`);
const collisionApply=rpc(`public.apply_employee_pin_change_v1('${A}','${collisionRef.commandRef}')`,'reject PIN collision');
if(collisionApply.ok!==false||collisionApply.code!=='pin_already_in_use') throw new Error(`PIN collision not rejected: ${JSON.stringify(collisionApply)}`);
if(scalar(`select pin_hash from public.business_employees where id='${E}'`,'employee collision unchanged')!==oldEmployeeHash) throw new Error('employee PIN changed on collision');
if(scalar(`select pin_hash from public.workers where id='${W}'`,'worker collision unchanged')!==oldWorkerHash) throw new Error('worker PIN changed on collision');

psql(['-c',`update public.workers set pin_lookup_hash=repeat('9',64) where id='${W3}';`],'clear test PIN collision');
const goodRef=rpc(
 `public.stage_employee_pin_change_v1('${A}','${E}',array['${S1}'::uuid],'pbkdf2-sha256$210000$22222222222222222222222222222222$2222222222222222222222222222222222222222222222222222222222222222',repeat('8',64),(select credential_version from public.business_employees where id='${E}'),null,now()+interval '1 hour','27000000-0000-4000-8000-000000000002')`,
 'stage good PIN'
);
const goodApply=rpc(`public.apply_employee_pin_change_v1('${A}','${goodRef.commandRef}')`,'apply PIN');
if(!goodApply.ok) throw new Error(`PIN apply failed: ${JSON.stringify(goodApply)}`);
const pinState=JSON.parse(scalar(`select jsonb_build_object(
 'employee',(select pin_hash from public.business_employees where id='${E}'),
 'worker',(select pin_hash from public.workers where id='${W}'),
 'employeeLookup',(select pin_lookup_hash from public.business_employees where id='${E}'),
 'workerLookup',(select pin_lookup_hash from public.workers where id='${W}')
)::text`,'PIN readback'));
if(pinState.employee!==pinState.worker||pinState.employeeLookup!==pinState.workerLookup) throw new Error('employee/worker credential propagation diverged');

const rollbackEmployeeHash=scalar(`select pin_hash from public.business_employees where id='${E}'`,'rollback employee baseline');
const rollbackWorkerHash=scalar(`select pin_hash from public.workers where id='${W}'`,'rollback worker baseline');
const rollbackRef=rpc(
 `public.stage_employee_pin_change_v1('${A}','${E}',array['${S1}'::uuid],'pbkdf2-sha256$210000$33333333333333333333333333333333$3333333333333333333333333333333333333333333333333333333333333333',repeat('7',64),(select credential_version from public.business_employees where id='${E}'),null,now()+interval '1 hour','27000000-0000-4000-8000-000000000003')`,
 'stage rollback PIN'
);
if(!rollbackRef.ok) throw new Error(`stage rollback PIN failed: ${JSON.stringify(rollbackRef)}`);
psql(['-c',`
create or replace function public.test_force_pin_rollback_v1()
returns trigger language plpgsql as $rollback$
begin
  if new.id='${E}'::uuid and new.pin_hash is distinct from old.pin_hash then
    raise exception 'TEST_PIN_ROLLBACK';
  end if;
  return new;
end $rollback$;
create trigger test_force_pin_rollback
before update on public.business_employees
for each row execute function public.test_force_pin_rollback_v1();
`],'install rollback trigger');
const rollbackAttempt=psql(
 ['-At','-c',`select public.apply_employee_pin_change_v1('${A}','${rollbackRef.commandRef}')::text`],
 'force PIN transaction rollback',
 {allowFailure:true}
);
if(rollbackAttempt.status===0 || !String(rollbackAttempt.stderr).includes('TEST_PIN_ROLLBACK')) {
  throw new Error('forced PIN rollback did not fail at employee credential update');
}
psql(['-c',`
drop trigger test_force_pin_rollback on public.business_employees;
drop function public.test_force_pin_rollback_v1();
`],'remove rollback trigger');
if(scalar(`select pin_hash from public.business_employees where id='${E}'`,'rollback employee unchanged')!==rollbackEmployeeHash) {
  throw new Error('employee credential changed despite transaction rollback');
}
if(scalar(`select pin_hash from public.workers where id='${W}'`,'rollback worker unchanged')!==rollbackWorkerHash) {
  throw new Error('linked worker credential partially committed before employee rollback');
}
if(scalar(`select (consumed_at is null)::text from private.admin_employee_pin_change_commands where command_ref='${rollbackRef.commandRef}'`,'rollback command remains pending')!=='true') {
  throw new Error('credential command was consumed despite transaction rollback');
}

const sessionBefore=Number(scalar(`select count(*) from public.worker_sessions where worker_id='${W}'`,'worker history before suspension'));
const suspended=rpc(`public.suspend_employee_v1('${A}','${E}',(select profile_version from public.business_employees where id='${E}'),'suspend-e')`,'suspend employee');
if(!suspended.ok) throw new Error(`suspension failed: ${JSON.stringify(suspended)}`);
if(Number(scalar(`select count(*) from public.worker_sessions where worker_id='${W}'`,'worker history after suspension'))!==sessionBefore) throw new Error('suspension deleted worker history');
if(scalar(`select active::text from public.workers where id='${W}'`,'linked worker inactive')!=='false') throw new Error('linked worker remained active');

console.log('Admin Plan 6 Workforce PostgreSQL integrity/idempotency behavior passed.');

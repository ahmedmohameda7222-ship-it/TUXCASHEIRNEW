import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const db = process.env.TEST_DATABASE_URL;
if (!db) {
  console.log('Isolated inventory-approval SQL test skipped: TEST_DATABASE_URL unset');
  process.exit(0);
}
if (!['localhost', '127.0.0.1', '::1'].includes(new URL(db).hostname))
  throw new Error('Refusing to mutate a non-loopback PostgreSQL database');
function execute(args, label) {
  const r = spawnSync('psql', [db, '-X', '-v', 'ON_ERROR_STOP=1', '-At', ...args], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(label + ': ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}
const sql = (statement, label = 'SQL') => execute(['-c', statement], label);
const rpc = (statement, label) => JSON.parse(sql('select (' + statement + ')::text', label));
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
create function auth.uid() returns uuid language sql stable as $do$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $do$;`, 'fixture reset');
const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const target = '20261012040200_admin_order_rule_shop_precedence.sql';
const targetIndex = migrations.indexOf(target);
if (targetIndex < 0) throw new Error('Inventory approval migration missing');
for (const name of migrations.slice(0,targetIndex+1))
  execute(['-f',resolve('supabase/migrations',name)],name);

// Both trusted financial-control RPCs must select shop-local policy first.
const shopPrecedence = sql(
  "select count(*) filter (where position('nulls last' in lower(pg_get_functiondef(p.oid)))>0)::text " +
    "|| '/' || count(*)::text from pg_proc p " +
    "join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname='public' and p.proname in " +
    "('request_admin_order_refund_v1','return_admin_order_items_v1')",
  'refund and return SQL shop precedence',
);
if(shopPrecedence!=='2/2')
  throw new Error('Trusted refund/return precedence is not NULL-safe: '+shopPrecedence);

const B='11111111-1111-4111-8111-111111111111';
const S='22222222-2222-4222-8222-222222222222';
const E='33333333-3333-4333-8333-333333333333';
const A='33333333-3333-4333-8333-333333333334';
const I='44444444-4444-4444-8444-444444444444';
const R='55555555-5555-4555-8555-555555555555';
const RULE='66666666-6666-4666-8666-666666666666';
const LOCAL='66666666-6666-4666-8666-666666666667';
sql(`
insert into public.businesses(id,name) values ('${B}','Inventory Tenant');
insert into public.shops(id,name,active,lifecycle_state) values ('${S}','Inventory Shop',true,'ACTIVE');
insert into public.business_shops(business_id,shop_id) values ('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active) values
  ('${E}','${B}','Owner','OWNER',true),('${A}','${B}','Approver','OWNER',true);
insert into public.employee_shop_assignments(business_id,employee_id,shop_id)
values ('${B}','${E}','${S}'),('${B}','${A}','${S}');
insert into public.inventory_items(id,shop_id,name,unit_label,tracking_mode,active)
  values ('${I}','${S}','Test Item','g','RECIPE_TRACKED',true);
`,'inventory fixture');
sql(`insert into public.admin_reason_codes(business_id,shop_id,id,reason_key,family,label,updated_by_employee_id)
values ('${B}',null,'${R}','COUNT_CORRECTION','STOCK_ADJUSTMENT','Count correction','${E}');
insert into public.admin_approval_rules(id,business_id,shop_id,action_type,
requester_permission,approver_permission,requires_second_person,threshold_context,active)
values ('${RULE}','${B}',null,'INVENTORY_ADJUST','inventory.adjust','approvals.review',true,
'{"minimumQuantityImpact":5}'::jsonb,true);`,'rules fixture');
function post(delta,id,employee=E) {
  return rpc(`public.post_inventory_adjustment_v1('${employee}'::uuid,'${S}'::uuid,'${I}'::uuid,${delta}::bigint,'${R}'::uuid,'Review','${id}',false)`,'post inventory');
}
function deny(result,code) {
  if(result.ok!==false || result.code!==code)
    throw new Error('Expected '+code+', got '+JSON.stringify(result));
}
const below=post(2000000,'below-2');
if(!below.ok || !below.movementId)throw new Error('Below-threshold direct post failed '+JSON.stringify(below));
deny(post(5000000,'at-5'),'inventory_approval_required');
deny(post(7000000,'above-7'),'inventory_approval_required');
deny(post(-5000000,'negative-5'),'insufficient_stock');
const counted=sql(`select count(*) from public.inventory_movements where shop_id='${S}' and movement_type='ADMIN_ADJUSTMENT'`);
if(counted!=='1')throw new Error('Pending approval posted stock directly');
sql(`insert into public.admin_approval_rules(id,business_id,shop_id,action_type,
requester_permission,approver_permission,requires_second_person,threshold_context,active)
values ('${LOCAL}','${B}','${S}','INVENTORY_ADJUST','inventory.adjust','approvals.review',true,
'{"minimumQuantityImpact":10}'::jsonb,true)`,'local override');
const shadowed=post(7000000,'shop-precedence-7');
if(!shadowed.ok || !shadowed.movementId)throw new Error('Shop rule did not shadow global threshold');
deny(post(11000000,'shop-threshold-11'),'inventory_approval_required');
const fence=rpc(`public.read_admin_inventory_adjustment_fence_v1('${E}'::uuid,'${S}'::uuid,'${I}'::uuid)`,'trusted stock fence');
if(!fence.ok || fence.expectedMovementCount!==2 || fence.expectedDefinitionVersion!==1)
  throw new Error('Incorrect trusted stock fence '+JSON.stringify(fence));

const commandId='approved-inventory-11';
const payload={
  shopId:S,inventoryItemId:I,quantityDeltaMicros:11000000,reasonCodeId:R,
  note:'Review',originalCommandId:commandId,emergencyNegativeOverride:false,
  expectedDefinitionVersion:fence.expectedDefinitionVersion,
  expectedMovementCount:fence.expectedMovementCount,
};
const cmd='77777777-7777-4777-8777-777777777777';
const created=rpc(`public.create_admin_approval_request_v1(
  '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${LOCAL}'::uuid,
  'INVENTORY_ADJUST','${cmd}'::uuid,'${JSON.stringify(payload)}'::jsonb,'Review'
)`,'create trusted approval request');
if(!created.ok || !created.requestId)throw new Error('Approval request creation '+JSON.stringify(created));
sql(`update public.admin_approval_rules set active=false
  where id in ('${RULE}','${LOCAL}')`, 'temporarily disable approval policy');
deny(post(11000000,commandId),'inventory_approval_command_locked');
sql(`update public.admin_approval_rules set active=true
  where id in ('${RULE}','${LOCAL}')`, 'restore approval policy');
const decision=rpc(`public.decide_admin_approval_request_v1(
  '${created.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Approve stock'
)`,'distinct approver');
if(!decision.ok)throw new Error('Approval decision '+JSON.stringify(decision));
const claims=JSON.parse(sql(
  "select coalesce(jsonb_agg(to_jsonb(claim)), '[]'::jsonb)::text " +
  "from public.claim_admin_approval_execution_v1('inventory-test',now(),10,300) claim",
  'claim approval',
));
if(!Array.isArray(claims) || !claims.some(x=>x.approval_request_id===created.requestId))
  throw new Error('Approval claim failed '+JSON.stringify(claims));
const input=(approver=A,quantity=11000000)=>
`public.execute_approved_admin_inventory_adjustment_v1(
'${created.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,
'${approver}'::uuid,'${I}'::uuid,${quantity}::bigint,'${R}'::uuid,
'Review','${commandId}',false,1,2)`;
deny(rpc(input(E),'self approval'),'approval_inventory_payload_or_state_mismatch');
deny(rpc(input(A,11000001),'altered approved payload'),'approval_inventory_payload_or_state_mismatch');
const posted=rpc(input(),'execute approved inventory');
if(!posted.ok || !posted.movementId)throw new Error('Approved inventory did not post '+JSON.stringify(posted));
const replay=rpc(input(),'retry approved inventory');
if(!replay.ok || replay.idempotentReplay!==true || replay.movementId!==posted.movementId)
  throw new Error('Approved inventory replay did not deduplicate '+JSON.stringify(replay));
const total=sql(`select count(*) from public.inventory_movements where shop_id='${S}' and movement_type='ADMIN_ADJUSTMENT'`);
if(total!=='3')throw new Error('Approved adjustment posted duplicate stock movement: '+total);
const audit=sql(`select count(*) from public.admin_audit_events where action_type='INVENTORY_ADJUSTMENT_APPROVED_POSTED' and shop_id='${S}'`);
if(audit!=='1')throw new Error('Approved inventory audit not exactly once');
for(const role of ['anon','authenticated']){
  for(const fn of ['public.read_admin_inventory_adjustment_fence_v1(uuid,uuid,uuid)','public.execute_approved_admin_inventory_adjustment_v1(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,boolean,bigint,bigint)']){
    if(sql(`select has_function_privilege('${role}','${fn}','EXECUTE')`)!=='f')
      throw new Error('Unsafe '+role+' grant: '+fn);
  }
}
console.log('Inventory adjustment approvals isolated PostgreSQL: threshold, precedence, request, decision, execution, replay and audit passed.');

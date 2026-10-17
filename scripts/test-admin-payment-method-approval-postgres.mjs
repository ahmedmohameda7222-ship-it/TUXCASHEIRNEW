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
const target = '20261016080723_admin_payment_method_create_second_person_approval.sql';
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

const Z = '97777777-7777-4777-8777-777777777777';
const ZR = '94444444-4444-4444-8444-444444444445';
const ZC = '95555555-5555-4555-8555-555555555556';
sql(`insert into public.delivery_zones(id,shop_id,name,fee_minor,active,sort_order)
values ('${Z}','${S}','Test zone',100,true,0);
insert into public.admin_approval_rules(
id,business_id,shop_id,action_type,requester_permission,approver_permission,
requires_second_person,threshold_context,active)
values ('${ZR}','${B}',null,'SETTINGS_PAYMENT_ZONE_CHANGE',
'settings.manage','approvals.review',true,'{}'::jsonb,true)`, 'zone policy fixture');
const zone = {
  shopId:S,paymentMethodId:PM,deliveryZoneId:Z,
  allowed:false,expectedAllowed:null,expectedSettingsVersion:0,
};
const directZone = (allowed = false) => `public.upsert_admin_payment_zone_rule_v1(
  '${E}'::uuid,'${S}'::uuid,'${PM}'::uuid,'${Z}'::uuid,${allowed},null,0)`;
deny(rpc(directZone(),'zone approval direct denial'),'payment_zone_approval_required');
const zoneCreated=rpc(`public.create_admin_approval_request_v1(
'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${ZR}'::uuid,
'SETTINGS_PAYMENT_ZONE_CHANGE','${ZC}'::uuid,
'${JSON.stringify(zone)}'::jsonb,'Zone restriction')`,'zone approval request');
if(!zoneCreated.ok||!zoneCreated.requestId)throw Error('Cannot create zone request');
sql(`update public.admin_approval_rules set active=false where id='${ZR}'`);
deny(rpc(directZone(),'zone pending rule-off bypass'),'payment_zone_approval_required');
deny(rpc(directZone(true),'zone changed value pending bypass'),'payment_zone_approval_required');
if(sql(`select count(*) from public.payment_method_zone_rules
where payment_method_id='${PM}' and delivery_zone_id='${Z}'`)!=='0')
 throw Error('Zone restriction applied before second approval');
sql(`update public.admin_approval_rules set active=true where id='${ZR}'`);
const zoneApproved=rpc(`public.decide_admin_approval_request_v1(
'${zoneCreated.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Approved')`,'zone second person');
if(!zoneApproved.ok)throw Error('Second approver rejected zone request');
const zoneClaims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
from public.claim_admin_approval_execution_v1('zone-test',now(),10,300)c`));
const zClaim=zoneClaims.find(x=>x.approval_request_id===zoneCreated.requestId);
if(!zClaim?.claim_token)throw Error('Zone approval claim missing');
const executeZone = (approver=A,allowed=false) =>
`public.execute_approved_admin_payment_zone_rule_v1(
'${zoneCreated.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
'${E}'::uuid,'${approver}'::uuid,'${PM}'::uuid,'${Z}'::uuid,
${allowed},null,0,'${ZC}'::uuid)`;
deny(rpc(executeZone(E),'zone self approval'),'approval_payment_zone_payload_or_state_mismatch');
deny(rpc(executeZone(A,true),'zone tampered command'),'approval_payment_zone_payload_or_state_mismatch');
const zoneApplied=rpc(executeZone(),'zone protected apply');
if(!zoneApplied.ok)throw Error('Zone approval did not execute: '+JSON.stringify(zoneApplied));
const zoneAgain=rpc(executeZone(),'zone protected duplicate');
if(!zoneAgain.ok||zoneAgain.idempotentReplay!==true)throw Error('Zone receipt replay failed');
const zoneCompletion=rpc(`public.complete_admin_approval_execution_v1(
'${zoneCreated.requestId}'::uuid,'${zClaim.claim_token}','EXECUTED',
null,'{}'::jsonb,now())`,'zone completion');
if(!zoneCompletion.ok)throw Error('Zone completion not durable');
const zoneAfter=rpc(executeZone(),'zone completed duplicate');
if(!zoneAfter.ok||zoneAfter.idempotentReplay!==true)throw Error('Zone completed replay failed');
if(sql(`select allowed::text from public.payment_method_zone_rules where
payment_method_id='${PM}' and delivery_zone_id='${Z}'`)!=='false')
throw Error('Incorrect approved zone restriction');
if(sql(`select count(*) from private.admin_payment_zone_approval_receipts
where payment_method_id='${PM}' and delivery_zone_id='${Z}'`)!=='1')
throw Error('Zone once-only receipt missing');
if(sql(`select count(*) from public.admin_audit_events
where action_type='SETTINGS_PAYMENT_ZONE_APPROVED_APPLIED' and shop_id='${S}'`)!=='1')
throw Error('Zone approval audit not exactly once');
for(const role of ['anon','authenticated']){
 if(sql(`select has_function_privilege('${role}',
'public.execute_approved_admin_payment_zone_rule_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,boolean,boolean,bigint,uuid)',
'EXECUTE')`)!=='f')throw Error('Zone SQL exposure to '+role);
}
console.log('Zone rule approval: isolated second-person, pending bypass, payload fence, once-only replay/audit passed.');

const RATES_RULE='94444444-4444-4444-8444-444444444446';
const RATES_CMD='95555555-5555-4555-8555-555555555557';
const baselinePublish=rpc(`public.publish_shop_settings_v1(
'${E}'::uuid,'${S}'::uuid,0)`,'initial no-policy settings publication');
if(!baselinePublish.ok||baselinePublish.settingsVersion!==1)
 throw Error('Fixture baseline publication failed: '+JSON.stringify(baselinePublish));
const taxStage=(value,expected)=>
`public.upsert_shop_setting_override_v1(
'${E}'::uuid,'${S}'::uuid,'checkout.taxBps','${value}'::jsonb,${expected})`;
const stage=rpc(taxStage(1400,'null'),'stage changed tax rate');
if(!stage.ok||stage.version!==1)throw Error('Cannot stage tax change: '+JSON.stringify(stage));
// RED: a schedule accepted before policy activation must be rejected if the
// approval policy is active when the scheduler tries to publish it.
const prePolicySchedule=rpc(`public.schedule_shop_settings_publish_v1(
'${E}'::uuid,'${S}'::uuid,1,
(now() at time zone 'Africa/Cairo' + interval '3 days')::timestamp)`,
'pre-existing schedule before checkout approval policy');
if(!prePolicySchedule.ok||!prePolicySchedule.scheduleId)
 throw Error('Cannot create pre-rule scheduled publish');
const ratePreview=rpc(`public.preview_admin_checkout_rate_publish_v1(
'${E}'::uuid,'${S}'::uuid,1)`,'preview checkout rate changes');
if(!ratePreview.ok||ratePreview.ratesChanged!==true||
 !/^[a-f0-9]{32}$/.test(ratePreview.payloadFingerprint))
 throw Error('Rate preview not trusted/hashed: '+JSON.stringify(ratePreview));
sql(`insert into public.admin_approval_rules(
id,business_id,shop_id,action_type,requester_permission,approver_permission,
requires_second_person,threshold_context,active)
values ('${RATES_RULE}','${B}',null,'SETTINGS_CHECKOUT_RATE_PUBLISH',
'settings.manage','approvals.review',true,'{}'::jsonb,true)`,'rate publish rule');
const configuredRateRule=rpc(`public.upsert_admin_approval_rule_v1(
'${E}'::uuid,'${S}'::uuid,'${RATES_RULE}'::uuid,null,
'SETTINGS_CHECKOUT_RATE_PUBLISH','settings.manage','approvals.review',
true,false,3600,'{}'::jsonb,true,1)`,'trusted rate rule CAS');
if(!configuredRateRule.ok)throw Error('Cannot configure rate rule');

const unsafeSchedule=rpc(`public.schedule_shop_settings_publish_v1(
'${E}'::uuid,'${S}'::uuid,1,
(now() at time zone 'Africa/Cairo' + interval '4 days')::timestamp)`,
'configured rate approval must block scheduled publish');
deny(unsafeSchedule,'checkout_rate_publish_approval_required');
sql(`update public.scheduled_config_changes set status='CLAIMED',
attempt_count=1,claimed_at=now()
where id='${prePolicySchedule.scheduleId}'`,'claim pre-rule scheduled request');
const scheduledKey=sql(`select idempotency_key from public.scheduled_config_changes
where id='${prePolicySchedule.scheduleId}'`);
deny(rpc(`public.apply_scheduled_shop_config_change_v1(
'${prePolicySchedule.scheduleId}'::uuid,'${scheduledKey}',1)`,
'policy-activated scheduled execution rejection'),'checkout_rate_publish_approval_required');
if(sql(`select coalesce(max(settings_version),0) from public.shop_settings_versions
where shop_id='${S}'`)!=='1')
 throw Error('Unapproved scheduled rate publication changed version');

const directPublish=()=>`public.publish_shop_settings_v1('${E}'::uuid,'${S}'::uuid,1)`;
deny(rpc(directPublish(),'direct rate publication rejected'),'checkout_rate_publish_approval_required');
const publishPayload={shopId:S,expectedSettingsVersion:1,payloadFingerprint:ratePreview.payloadFingerprint};
const rateRequest=rpc(`public.create_admin_approval_request_v1(
'${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${RATES_RULE}'::uuid,
'SETTINGS_CHECKOUT_RATE_PUBLISH','${RATES_CMD}'::uuid,
'${JSON.stringify(publishPayload)}'::jsonb,'Checkout tax change')`,'queue rate approval');
if(!rateRequest.ok||!rateRequest.requestId)throw Error('Rate request not durable');
sql(`update public.admin_approval_rules set active=false where id='${RATES_RULE}'`);
deny(rpc(directPublish(),'pending rate policy disabled'),'checkout_rate_publish_approval_required');

const pendingRateSchedule=rpc(`public.schedule_shop_settings_publish_v1(
'${E}'::uuid,'${S}'::uuid,1,
(now() at time zone 'Africa/Cairo' + interval '5 days')::timestamp)`,
'disabled policy must not allow a pending rate approval to be scheduled');
deny(pendingRateSchedule,'checkout_rate_publish_approval_required');
const changedDraft=rpc(taxStage(1500,'1'),'tamper staged tax rate after request');
if(!changedDraft.ok)throw Error('Staging tampered fixture failed');
deny(rpc(directPublish(),'pending changed tax digest'),'checkout_rate_publish_approval_required');
sql(`update public.admin_approval_rules set active=true where id='${RATES_RULE}'`);
const rateDecision=rpc(`public.decide_admin_approval_request_v1(
'${rateRequest.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Approved')`,'rate second approval');
if(!rateDecision.ok)throw Error('Tax second approver rejected');
const rateClaims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
from public.claim_admin_approval_execution_v1('tax-test',now(),10,300)c`));
const rateClaim=rateClaims.find(x=>x.approval_request_id===rateRequest.requestId);
if(!rateClaim?.claim_token)throw Error('Rate approval not claimed');
const executeRates=(approver=A,fp=ratePreview.payloadFingerprint)=>
`public.execute_approved_admin_checkout_rate_publish_v1(
'${rateRequest.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
'${E}'::uuid,'${approver}'::uuid,1,'${fp}','${RATES_CMD}'::uuid)`;
deny(rpc(executeRates(E),'deny self-approved rate publish'),'approval_checkout_rate_payload_or_state_mismatch');
deny(rpc(executeRates(A,'00000000000000000000000000000000'),'deny changed digest'),'approval_checkout_rate_payload_or_state_mismatch');
deny(rpc(executeRates(),'reject changed effective draft at worker'),'checkout_rate_publish_approval_required');
const restore=rpc(taxStage(1400,'2'),'restore exact approved candidate');
if(!restore.ok)throw Error('Could not restore approved candidate');
const stillSame=rpc(`public.preview_admin_checkout_rate_publish_v1(
'${E}'::uuid,'${S}'::uuid,1)`,'check same candidate digest');
if(stillSame.payloadFingerprint!==ratePreview.payloadFingerprint)
 throw Error('Candidate digest mutated despite same published contents');
const posted=rpc(executeRates(),'second-person publish exact candidate');
if(!posted.ok||posted.settingsVersion!==2)throw Error('Approved tax publish failed: '+JSON.stringify(posted));
const rateReplay=rpc(executeRates(),'replay approved rate publish');
if(!rateReplay.ok||rateReplay.idempotentReplay!==true)
 throw Error('Approved rate replay not idempotent: '+JSON.stringify(rateReplay));
const rateCompletion=rpc(`public.complete_admin_approval_execution_v1(
'${rateRequest.requestId}'::uuid,'${rateClaim.claim_token}','EXECUTED',
null,'{}'::jsonb,now())`,'complete rate worker');
if(!rateCompletion.ok)throw Error('Rate completion not durable');
const rateAfter=rpc(executeRates(),'fully completed rate replay');
if(!rateAfter.ok||rateAfter.idempotentReplay!==true)
 throw Error('Rate full completion replay failed');
if(sql(`select count(*) from private.admin_checkout_rate_publish_approval_receipts
where shop_id='${S}'`)!=='1')throw Error('Rate publish receipt not unique');
if(sql(`select count(*) from public.admin_audit_events
where action_type='SETTINGS_CHECKOUT_RATE_APPROVED_PUBLISHED' and shop_id='${S}'`)!=='1')
throw Error('Rate published audit not exactly once');
if(sql(`select (settings_json->'settings'->'values'->>'checkout.taxBps')
from public.shop_settings_versions where shop_id='${S}' and settings_version=2`)!=='1400')
throw Error('Published tax rate not approved value');
for(const role of ['anon','authenticated']){
 if(sql(`select has_function_privilege('${role}',
'public.execute_approved_admin_checkout_rate_publish_v1(uuid,uuid,uuid,uuid,uuid,bigint,text,uuid)',
'EXECUTE')`)!=='f')throw Error('Tax approval RPC exposed to '+role);
}
console.log('Checkout Tax publish: active and disabled-rule denial, changed draft digest, second-person, once-only receipt/audit passed.');


const CREATE_RULE='94444444-4444-4444-8444-444444444447';
const CREATE_APPROVAL_CMD='95555555-5555-4555-8555-555555555558';
const CREATE_IDEMPOTENCY='create-new-card-test';
const newPayment = {
  shopId:S,commandId:CREATE_IDEMPOTENCY,displayName:'Digital Wallet',
  logicType:'DIGITAL',active:true,sortOrder:20,channel:'BOTH',
  requiresReference:true,manualConfirmationRequired:false,
  refundAllowed:false,expectedSettingsVersion:2,
};
sql(`insert into public.admin_approval_rules(
 id,business_id,shop_id,action_type,requester_permission,approver_permission,
 requires_second_person,threshold_context,active)
 values ('${CREATE_RULE}','${B}',null,'SETTINGS_PAYMENT_METHOD_CREATE',
 'settings.manage','approvals.review',true,'{}'::jsonb,true)`,'create payment approval rule');
const configuredCreate=rpc(`public.upsert_admin_approval_rule_v1(
 '${E}'::uuid,'${S}'::uuid,'${CREATE_RULE}'::uuid,null,
 'SETTINGS_PAYMENT_METHOD_CREATE','settings.manage','approvals.review',
 true,false,3600,'{}'::jsonb,true,1)`,'trusted payment create rule');
if(!configuredCreate.ok)throw Error('Payment create rule invalid');
const directCreate=(id=CREATE_IDEMPOTENCY,name='Digital Wallet')=>
`public.create_admin_payment_method_v2(
 '${E}'::uuid,'${S}'::uuid,'${name}','DIGITAL',true,20,
 'BOTH',true,false,false,2,'${id}')`;
deny(rpc(directCreate(),'configured direct payment create'),
'payment_method_create_approval_required');
deny(rpc(`public.create_admin_payment_method_v1(
 '${E}'::uuid,'${S}'::uuid,'Legacy Digital','DIGITAL',
 true,21,'BOTH',true,false,2,'legacy-create-bypass')`,
 'legacy direct create bypass'),'payment_method_create_approval_required');
const createdCreate=rpc(`public.create_admin_approval_request_v1(
 '${B}'::uuid,'${S}'::uuid,'${E}'::uuid,null,'${CREATE_RULE}'::uuid,
 'SETTINGS_PAYMENT_METHOD_CREATE','${CREATE_APPROVAL_CMD}'::uuid,
 '${JSON.stringify(newPayment)}'::jsonb,'Add wallet payment')`, 'create payment approval request');
if(!createdCreate.ok||!createdCreate.requestId)throw Error('Missing payment create approval request');
sql(`update public.admin_approval_rules set active=false where id='${CREATE_RULE}'`);
deny(rpc(directCreate(),'pending direct payment create bypass'),
'payment_method_create_approval_required');
deny(rpc(directCreate('different-command','Changed Name'),'changed id bypass'),
'payment_method_create_approval_required');
const pendingMethods=sql(`select count(*) from public.payment_methods
 where shop_id='${S}' and display_name='Digital Wallet'`);
if(pendingMethods!=='0')throw Error('Payment method materialized before second approval');
sql(`update public.admin_approval_rules set active=true where id='${CREATE_RULE}'`);
const createApproved=rpc(`public.decide_admin_approval_request_v1(
 '${createdCreate.requestId}'::uuid,'${A}'::uuid,null,'APPROVE','Approved')`,'create second approver');
if(!createApproved.ok)throw Error('Payment create second person rejected');
const createClaims=JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)::text
 from public.claim_admin_approval_execution_v1('create-test',now(),10,300)c`));
const createClaim=createClaims.find(x=>x.approval_request_id===createdCreate.requestId);
if(!createClaim?.claim_token)throw Error('Payment create request not claimable');
const executeCreate=(approver=A,name='Digital Wallet')=>
`public.execute_approved_admin_payment_method_create_v1(
 '${createdCreate.requestId}'::uuid,'${B}'::uuid,'${S}'::uuid,
 '${E}'::uuid,'${approver}'::uuid,'${CREATE_IDEMPOTENCY}',
 '${name}','DIGITAL',true,20,'BOTH',true,false,false,2,
 '${CREATE_APPROVAL_CMD}'::uuid)`;
deny(rpc(executeCreate(E),'self-create denial'),
'approval_payment_create_payload_or_state_mismatch');
deny(rpc(executeCreate(A,'Tampered'),'changed name approval denial'),
'approval_payment_create_payload_or_state_mismatch');
const createdPayment=rpc(executeCreate(),'trusted create execution');
if(!createdPayment.ok||!createdPayment.paymentMethodId||createdPayment.editVersion!==1)
 throw Error('Payment create not committed: '+JSON.stringify(createdPayment));
const createReplay=rpc(executeCreate(),'same approved create replay');
if(!createReplay.ok||createReplay.idempotentReplay!==true||
 createReplay.paymentMethodId!==createdPayment.paymentMethodId)
 throw Error('Payment method create replay failed');
const createCompleted=rpc(`public.complete_admin_approval_execution_v1(
 '${createdCreate.requestId}'::uuid,'${createClaim.claim_token}',
 'EXECUTED',null,'{}'::jsonb,now())`,'payment create worker complete');
if(!createCompleted.ok)throw Error('Payment create worker completion failed');
const createFinalReplay=rpc(executeCreate(),'completed payment create replay');
if(!createFinalReplay.ok||createFinalReplay.idempotentReplay!==true)
 throw Error('Payment create approval not replay-safe after completion');
if(sql(`select count(*) from private.admin_payment_method_create_approval_receipts
 where shop_id='${S}'`)!=='1')throw Error('Payment create receipt count not one');
if(sql(`select count(*) from public.admin_audit_events
 where action_type='SETTINGS_PAYMENT_METHOD_APPROVED_CREATED' and shop_id='${S}'`)!=='1')
 throw Error('Payment create approval audit should be once-only');
if(sql(`select count(*) from public.payment_methods
 where shop_id='${S}' and display_name='Digital Wallet' and refund_allowed=false`)!=='1')
 throw Error('Payment create policy or count incorrect');
for(const role of ['anon','authenticated']){
 if(sql(`select has_function_privilege('${role}',
 'public.execute_approved_admin_payment_method_create_v1(uuid,uuid,uuid,uuid,uuid,text,text,text,boolean,integer,text,boolean,boolean,boolean,bigint,uuid)',
 'EXECUTE')`)!=='f')throw Error('Unsafe approved-create EXECUTE for '+role);
}
console.log('Payment method CREATE approval: active/disabled policy, legacy bypass, distinct person, exact payload and once-only receipts passed.');

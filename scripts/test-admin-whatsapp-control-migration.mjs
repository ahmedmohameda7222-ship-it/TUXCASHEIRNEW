import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Admin WhatsApp control PostgreSQL test requires TEST_DATABASE_URL.');
const parsed = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname)) {
  throw new Error('Admin WhatsApp control test refuses non-loopback PostgreSQL.');
}
const dockerContainer = process.env.TEST_PSQL_DOCKER_CONTAINER;

function commandArgs(args) {
  return dockerContainer
    ? ['exec', '-i', dockerContainer, 'psql', 'postgresql://postgres:postgres@127.0.0.1:5432/tux_daily', '-X', '-v', 'ON_ERROR_STOP=1', ...args]
    : [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args];
}

function psql(args, label, allowFailure = false) {
  let input;
  const normalized = [...args];
  const fileIndex = normalized.indexOf('-f');
  if (fileIndex >= 0) {
    input = readFileSync(normalized[fileIndex + 1], 'utf8');
    normalized.splice(fileIndex, 2, '-f', '-');
  }
  const result = spawnSync(dockerContainer ? 'docker' : 'psql', commandArgs(normalized), {
    encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result;
}

function scalar(sql, label) { return psql(['-At', '-c', sql], label).stdout.trim(); }

function concurrentScalar(sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(dockerContainer ? 'docker' : 'psql', commandArgs(['-At', '-c', sql]), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(stderr)));
  });
}

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
const target = migrations.find((name) => name.endsWith('_admin_whatsapp_commands.sql'));
if (!target) throw new Error('Admin WhatsApp control migration missing.');
for (const migration of migrations.slice(0, migrations.indexOf(target) + 1)) {
  psql(['-f', resolve('supabase/migrations', migration)], migration);
}

const B1='81000000-0000-4000-8000-000000000001', B2='81000000-0000-4000-8000-000000000002';
const S1='82000000-0000-4000-8000-000000000001', S2='82000000-0000-4000-8000-000000000002';
const A1='83000000-0000-4000-8000-000000000001', A2='83000000-0000-4000-8000-000000000002';
const W1='84000000-0000-4000-8000-000000000001', DEV1='85000000-0000-4000-8000-000000000001';
const C1='86000000-0000-4000-8000-000000000001', CH1='87000000-0000-4000-8000-000000000001', CH2='87000000-0000-4000-8000-000000000002';
const O1='88000000-0000-4000-8000-000000000001', R1='89000000-0000-4000-8000-000000000001';
const BD1='8a000000-0000-4000-8000-000000000001', OT1='8b000000-0000-4000-8000-000000000001';

psql(['-c', `
insert into public.businesses(id,name) values('${B1}','WhatsApp A'),('${B2}','WhatsApp B');
insert into public.shops(id,name,active) values('${S1}','Shop A',true),('${S2}','Shop B',true);
insert into public.business_shops(business_id,shop_id) values('${B1}','${S1}'),('${B2}','${S2}');
insert into public.business_employees(id,business_id,display_name,role,active) values('${A1}','${B1}','Owner A','OWNER',true),('${A2}','${B2}','Owner B','OWNER',true);
insert into public.workers(id,shop_id,display_name,pin_hash,active) values('${W1}','${S1}','Worker A','hash',true);
insert into public.devices(id,shop_id,label,active) values('${DEV1}','${S1}','Till A',true);
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id) values('${BD1}','${S1}','OPEN',now(),'${W1}');
insert into public.order_types(id,shop_id,name,behavior,active,sort_order) values('${OT1}','${S1}','Take away','TAKE_AWAY',true,0);
insert into public.orders(id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,operator_worker_id,operator_name_snapshot,order_type_id,order_type_label_snapshot,order_type_behavior_snapshot,items_subtotal_minor,total_minor,created_at,updated_at)
 values('${O1}','${S1}','${BD1}',1,'wa-order','POS','ACTIVE','${W1}','Worker A','${OT1}','Take away','TAKE_AWAY',100,100,now(),now());
insert into public.whatsapp_conversations(id,shop_id,normalized_phone,display_phone,context) values('${C1}','${S1}','01000000000','+201000000000','DIRECT');
insert into public.whatsapp_channels(id,shop_id,provider,provider_phone_number_id,active) values('${CH1}','${S1}','META_CLOUD_API','provider-a',true),('${CH2}','${S2}','META_CLOUD_API','provider-b',true);
insert into public.whatsapp_admin_quick_replies(business_id,shop_id,title,body,updated_by_employee_id) values('${B1}','${S1}','Greeting','Hello','${A1}');
`], 'fixtures');

if (scalar(`select automation_enabled::text||':'||version from public.whatsapp_admin_preferences where business_id='${B1}' and shop_id='${S1}'`, 'preference default') !== 'false:1') {
  throw new Error('Automation must default off with version 1.');
}

psql(['-c', `insert into public.whatsapp_messages(shop_id,conversation_id,outbound_intent_key,direction,kind,text,status,sent_by_worker_id,initiated_by_device_id,initiated_at) values('${S1}','${C1}','worker:1','OUTBOUND','TEXT','hello','PENDING','${W1}','${DEV1}',now())`], 'legacy worker outbound');
if (scalar(`select sender_kind from public.whatsapp_messages where outbound_intent_key='worker:1'`, 'worker sender kind') !== 'WORKER') throw new Error('Legacy worker path did not preserve WORKER attribution.');

const fakeSystem = psql(['-c', `insert into public.whatsapp_messages(shop_id,conversation_id,outbound_intent_key,direction,kind,text,status,sender_kind,sent_by_worker_id,initiated_by_device_id,initiated_at) values('${S1}','${C1}','system:fake','OUTBOUND','TEXT','bad','PENDING','SYSTEM','${W1}','${DEV1}',now())`], 'reject fake system worker', true);
if (fakeSystem.status === 0) throw new Error('SYSTEM message accepted fake worker/device attribution.');

const crossChannel = psql(['-c', `insert into public.whatsapp_event_message_rules(id,business_id,shop_id,channel_id,event_type,provider_template_id,language_code,updated_by_employee_id) values('${R1}','${B1}','${S1}','${CH2}','ORDER_ACCEPTED','accepted','ar_EG','${A1}')`], 'reject cross-shop channel', true);
if (crossChannel.status === 0) throw new Error('Cross-shop channel FK was accepted.');

psql(['-c', `insert into public.whatsapp_event_message_rules(id,business_id,shop_id,channel_id,event_type,provider_template_id,language_code,updated_by_employee_id) values('${R1}','${B1}','${S1}','${CH1}','ORDER_ACCEPTED','accepted','ar_EG','${A1}')`], 'event rule');
if (scalar(`select enabled::text from public.whatsapp_event_message_rules where id='${R1}'`, 'rule default') !== 'false') throw new Error('Event rule must default off.');
psql(['-c', `update public.whatsapp_event_message_rules set enabled=true where id='${R1}'`], 'enable fixture rule');

const sourceEvent='8c000000-0000-4000-8000-000000000001';
psql(['-c', `insert into public.online_order_requests(id,shop_id,idempotency_key,request_sha256,catalog_revision,status,fulfillment_preference,payment_preference,customer_name,trusted_items,items_subtotal_minor,accepted_order_id,resolved_at) values('${sourceEvent}','${S1}','8d000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),'ACCEPTED','PICKUP','CASH','Customer','[{"productId":"test"}]'::jsonb,100,'${O1}',now())`], 'canonical accepted event');
const enqueueSql = `select public.enqueue_whatsapp_event_send_intent_v1('${B1}','${S1}','${O1}','${sourceEvent}','ORDER_ACCEPTED','${R1}')`;
const [intentA, intentB] = await Promise.all([concurrentScalar(enqueueSql), concurrentScalar(enqueueSql)]);
if (intentA !== intentB || !intentA) throw new Error('Concurrent duplicate source event did not converge on one intent.');
if (scalar(`select count(*) from public.whatsapp_event_send_intents where source_event_id='${sourceEvent}'`, 'dedupe count') !== '1') throw new Error('Duplicate source event created multiple intents.');

const crossBusiness = psql(['-c', `update public.whatsapp_admin_quick_replies set updated_by_employee_id='${A2}' where business_id='${B1}'`], 'reject cross-business actor', true);
if (crossBusiness.status === 0) throw new Error('Cross-business actor update was accepted.');

const leaseOne = JSON.parse(scalar(`select coalesce(jsonb_agg(x),'[]'::jsonb)::text from public.lease_whatsapp_event_send_intents_v1('worker-a','token-a',10,60) x`, 'first lease'));
const leaseTwo = JSON.parse(scalar(`select coalesce(jsonb_agg(x),'[]'::jsonb)::text from public.lease_whatsapp_event_send_intents_v1('worker-b','token-b',10,60) x`, 'second lease'));
if (leaseOne.length !== 1 || leaseTwo.length !== 0) throw new Error('Lease ownership was not exclusive.');
psql(['-c', `update public.whatsapp_event_send_intents set status='UNCERTAIN',lease_owner=null,lease_token=null,lease_until=null where id='${intentA}'`], 'mark uncertain');
const uncertainLease = JSON.parse(scalar(`select coalesce(jsonb_agg(x),'[]'::jsonb)::text from public.lease_whatsapp_event_send_intents_v1('worker-c','token-c',10,60) x`, 'uncertain lease'));
if (uncertainLease.length !== 0) throw new Error('UNCERTAIN intent became eligible for resend.');

const staleCommand = JSON.parse(scalar(`select public.manage_admin_whatsapp_v1('${B1}','${A1}','${S1}','channel-stale',99,'channel.assign',jsonb_build_object('channelId','${CH1}'))::text`, 'stale CAS'));
if (staleCommand.ok !== false || staleCommand.code !== 'stale_version') throw new Error('Stale Admin WhatsApp CAS was not rejected.');
const channelCommand = JSON.parse(scalar(`select public.manage_admin_whatsapp_v1('${B1}','${A1}','${S1}','channel-1',1,'channel.assign',jsonb_build_object('channelId','${CH1}'))::text`, 'channel assignment'));
const channelReplay = JSON.parse(scalar(`select public.manage_admin_whatsapp_v1('${B1}','${A1}','${S1}','channel-1',1,'channel.assign',jsonb_build_object('channelId','${CH1}'))::text`, 'channel replay'));
if (!channelCommand.ok || channelCommand.version !== 2 || channelReplay.replayed !== true) throw new Error('Admin WhatsApp command CAS/replay failed.');
if (scalar(`select count(*) from public.admin_audit_events where business_id='${B1}' and action_type='WHATSAPP_CHANNEL_ASSIGN'`, 'WhatsApp audit count') !== '1') throw new Error('WhatsApp command audit was not append-only/idempotent.');

if (scalar(`select has_table_privilege('authenticated','public.whatsapp_event_send_intents','SELECT')`, 'least privilege') !== 'f') throw new Error('Authenticated role unexpectedly has direct intent access.');
console.log('Admin WhatsApp control PostgreSQL isolation, attribution, dedupe and lease invariants passed; provider calls: 0.');

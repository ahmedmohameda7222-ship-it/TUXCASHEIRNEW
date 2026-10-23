/* global process, URL, console */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('WhatsApp event idempotency test requires TEST_DATABASE_URL.');
const parsed = new URL(databaseUrl);
if (!new Set(['127.0.0.1', 'localhost', '::1']).has(parsed.hostname))
  throw new Error('WhatsApp event test refuses non-loopback PostgreSQL.');
const dockerContainer = process.env.TEST_PSQL_DOCKER_CONTAINER;
const commandArgs = (args) =>
  dockerContainer
    ? [
        'exec',
        '-i',
        dockerContainer,
        'psql',
        'postgresql://postgres:postgres@127.0.0.1:5432/tux_daily',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        ...args,
      ]
    : [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', ...args];

function psql(args, label, allowFailure = false) {
  let input;
  const normalized = [...args];
  const fileIndex = normalized.indexOf('-f');
  if (fileIndex >= 0) {
    input = readFileSync(normalized[fileIndex + 1], 'utf8');
    normalized.splice(fileIndex, 2, '-f', '-');
  }
  const result = spawnSync(dockerContainer ? 'docker' : 'psql', commandArgs(normalized), {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
  return result;
}
const scalar = (sql, label) => psql(['-At', '-c', sql], label).stdout.trim();
function concurrentScalar(sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(dockerContainer ? 'docker' : 'psql', commandArgs(['-At', '-c', sql]), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(stderr)),
    );
  });
}

psql(
  [
    '-c',
    `
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
`,
  ],
  'fixture reset',
);

const migrations = readdirSync(resolve('supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const target = migrations.find((name) => name.endsWith('_whatsapp_event_dispatch.sql'));
if (!target) throw new Error('WhatsApp event dispatch migration missing.');
for (const migration of migrations.slice(0, migrations.indexOf(target) + 1))
  psql(['-f', resolve('supabase/migrations', migration)], migration);

const B = '91000000-0000-4000-8000-000000000001',
  S = '92000000-0000-4000-8000-000000000001';
const A = '93000000-0000-4000-8000-000000000001',
  W = '94000000-0000-4000-8000-000000000001';
const DEV = '94500000-0000-4000-8000-000000000001';
const BD = '95000000-0000-4000-8000-000000000001',
  OT = '96000000-0000-4000-8000-000000000001';
const CH = '97000000-0000-4000-8000-000000000001',
  T = '98000000-0000-4000-8000-000000000001';
const R = '99000000-0000-4000-8000-000000000001';

psql(
  [
    '-c',
    `
insert into public.businesses(id,name) values('${B}','Event Business');
insert into public.shops(id,name,active,address_text) values('${S}','TUX Maadi',true,'Maadi');
insert into public.business_shops(business_id,shop_id) values('${B}','${S}');
insert into public.business_employees(id,business_id,display_name,role,active) values('${A}','${B}','Owner','OWNER',true);
insert into public.workers(id,shop_id,display_name,pin_hash,active) values('${W}','${S}','Worker','hash',true);
insert into public.devices(id,shop_id,label,active) values('${DEV}','${S}','Test device',true);
insert into public.business_days(id,shop_id,status,started_at,started_by_worker_id) values('${BD}','${S}','OPEN',now(),'${W}');
insert into public.order_types(id,shop_id,name,behavior,active,sort_order) values('${OT}','${S}','Take away','TAKE_AWAY',true,0);
insert into public.whatsapp_channels(id,shop_id,provider,provider_phone_number_id,active) values('${CH}','${S}','META_CLOUD_API','provider-phone',true);
insert into public.whatsapp_starter_templates(id,shop_id,channel_id,display_label,provider_template_name,language_code,preview_text,provider_status,active)
 values('${T}','${S}','${CH}','Accepted','order_accepted','ar_EG','Order accepted','APPROVED',true);
insert into public.whatsapp_event_message_rules(id,business_id,shop_id,channel_id,event_type,provider_template_id,language_code,enabled,updated_by_employee_id)
 values('${R}','${B}','${S}','${CH}','ORDER_ACCEPTED','order_accepted','ar_EG',true,'${A}');
update public.whatsapp_admin_preferences set automation_enabled=true where business_id='${B}' and shop_id='${S}';
insert into public.whatsapp_contact_messaging_consents(business_id,shop_id,normalized_phone,opted_in,consent_source,consented_at)
 values('${B}','${S}','01012345678',true,'LOCAL_TEST',now());
`,
  ],
  'fixtures',
);

function addAccepted(sequence) {
  const order = `a1${String(sequence).padStart(6, '0')}-0000-4000-8000-000000000001`;
  const request = `b1${String(sequence).padStart(6, '0')}-0000-4000-8000-000000000001`;
  const idem = `c1${String(sequence).padStart(6, '0')}-0000-4000-8000-000000000001`;
  psql(
    [
      '-c',
      `
    insert into public.online_order_requests(id,shop_id,idempotency_key,request_sha256,catalog_revision,status,fulfillment_preference,payment_preference,customer_name,normalized_phone,trusted_items,items_subtotal_minor)
    values('${request}','${S}','${idem}',repeat('a',64),repeat('b',64),'PENDING','PICKUP','CASH','Ahmed Ali','01012345678','[{"productId":"test"}]'::jsonb,100);
    insert into private.online_order_processing_reservations(request_id,processing_order_id,shop_id,origin_device_id)
    values('${request}','${order}','${S}','${DEV}');
    insert into public.orders(id,shop_id,business_day_id,display_order_no,idempotency_key,source,status,operator_worker_id,operator_name_snapshot,order_type_id,order_type_label_snapshot,order_type_behavior_snapshot,items_subtotal_minor,total_minor,created_at,updated_at)
    values('${order}','${S}','${BD}',${sequence},'event-${sequence}','ONLINE','ACTIVE','${W}','Worker','${OT}','Take away','TAKE_AWAY',100,100,now(),now());
  `,
    ],
    `accepted event ${sequence}`,
  );
  return {
    order,
    request,
    intent: scalar(
      `select id from public.whatsapp_event_send_intents where source_event_id='${request}'`,
      `intent ${sequence}`,
    ),
  };
}

const first = addAccepted(1);
psql(
  ['-c', `update public.online_order_requests set updated_at=now() where id='${first.request}'`],
  'source replay',
);
if (
  scalar(
    `select count(*) from public.whatsapp_event_send_intents where source_event_id='${first.request}'`,
    'emitter dedupe',
  ) !== '1'
)
  throw new Error('Repeated source event created duplicate intents.');

const leaseSql = (owner, token) =>
  `select coalesce(jsonb_agg(x),'[]'::jsonb)::text from public.lease_whatsapp_event_send_intents_v2('${owner}','${token}',10,60) x`;
const [leaseA, leaseB] = await Promise.all([
  concurrentScalar(leaseSql('dispatcher-a', 'token-a')),
  concurrentScalar(leaseSql('dispatcher-b', 'token-b')),
]);
const claims = [...JSON.parse(leaseA), ...JSON.parse(leaseB)];
if (claims.length !== 1 || claims[0].intent_id !== first.intent)
  throw new Error('Concurrent dispatchers did not claim exactly one intent.');
const token = claims[0].lease_token;
const prepared = JSON.parse(
  scalar(
    `select coalesce(jsonb_agg(x),'[]'::jsonb)::text from public.begin_whatsapp_event_provider_attempt_v1('${first.intent}','${token}') x`,
    'begin provider attempt',
  ),
);
if (prepared.length !== 1 || prepared[0].variables.join('|') !== 'Ahmed|1|ACCEPTED|TUX Maadi|Maadi')
  throw new Error('Canonical dispatch variables were not derived safely.');
if (
  scalar(
    `select sender_kind||':'||coalesce(sent_by_worker_id::text,'none')||':'||coalesce(initiated_by_device_id::text,'none') from public.whatsapp_messages where system_event_intent_id='${first.intent}'`,
    'system attribution',
  ) !== 'SYSTEM:none:none'
)
  throw new Error('System message fabricated worker/device attribution.');
psql(
  [
    '-c',
    `select public.complete_whatsapp_event_provider_attempt_v1('${first.intent}','${token}','UNCERTAIN',null,'PROVIDER_OUTCOME_UNKNOWN')`,
  ],
  'uncertain completion',
);
if (JSON.parse(scalar(leaseSql('dispatcher-c', 'token-c'), 'uncertain no retry')).length !== 0)
  throw new Error('UNCERTAIN intent became retryable.');

const success = addAccepted(2);
const successLease = JSON.parse(scalar(leaseSql('dispatcher-d', 'token-d'), 'success lease'))[0];
psql(
  [
    '-c',
    `select * from public.begin_whatsapp_event_provider_attempt_v1('${success.intent}','${successLease.lease_token}'); select public.complete_whatsapp_event_provider_attempt_v1('${success.intent}','${successLease.lease_token}','SENT','wamid.success',null)`,
  ],
  'successful provider result',
);
psql(
  [
    '-c',
    `select public.update_tux_whatsapp_message_status_v1('${S}','wamid.success','READ'); select public.update_tux_whatsapp_message_status_v1('${S}','wamid.success','SENT'); select public.update_tux_whatsapp_message_status_v1('${S}','wamid.success','FAILED','late','late callback')`,
  ],
  'duplicate and out-of-order callbacks',
);
if (
  scalar(
    `select status from public.whatsapp_messages where system_event_intent_id='${success.intent}'`,
    'monotonic callback',
  ) !== 'READ'
)
  throw new Error('Out-of-order callback reverted confirmed status.');

const expired = addAccepted(3);
const oldLease = JSON.parse(scalar(leaseSql('dispatcher-e', 'token-e'), 'expiring lease'))[0];
psql(
  [
    '-c',
    `update public.whatsapp_event_send_intents set lease_until=now()-interval '1 second' where id='${expired.intent}'`,
  ],
  'expire before provider',
);
const recovered = JSON.parse(scalar(leaseSql('dispatcher-f', 'token-f'), 'recovered lease'))[0];
if (oldLease.intent_id !== recovered.intent_id || oldLease.lease_token === recovered.lease_token)
  throw new Error('Lease expiry before provider call did not recover safely.');

const disabled = addAccepted(4);
psql(
  ['-c', `update public.whatsapp_event_message_rules set enabled=false where id='${R}'`],
  'disable rule after event',
);
const disabledLease = JSON.parse(
  scalar(leaseSql('dispatcher-g', 'token-g'), 'disabled rule lease'),
).find((row) => row.intent_id === disabled.intent);
scalar(
  `select count(*) from public.begin_whatsapp_event_provider_attempt_v1('${disabled.intent}','${disabledLease.lease_token}')`,
  'disabled rule prepare',
);
if (
  scalar(
    `select last_error_code from public.whatsapp_event_send_intents where id='${disabled.intent}'`,
    'disabled rule reason',
  ) !== 'RULE_DISABLED_OR_CHANGED'
)
  throw new Error('Disabled rule did not cancel with a safe reason.');

if (
  scalar(
    `select has_function_privilege('service_role','public.lease_whatsapp_event_send_intents_v1(text,text,integer,integer)','EXECUTE')`,
    'legacy lease revoked',
  ) !== 'f'
)
  throw new Error('Legacy lease bypass remains executable.');
if (
  scalar(
    `select has_table_privilege('service_role','public.whatsapp_contact_messaging_consents','INSERT')`,
    'consent write denied',
  ) !== 'f'
)
  throw new Error('Dispatcher can fabricate opt-in consent.');
const auditMutation = psql(
  ['-c', `delete from public.whatsapp_event_intent_audit where intent_id='${first.intent}'`],
  'append-only audit',
  true,
);
if (auditMutation.status === 0) throw new Error('Event intent audit accepted deletion.');

console.log(
  'WhatsApp event emitter, concurrent lease, canonical validation, SYSTEM attribution, uncertainty and callback idempotency passed; provider calls: 0.',
);

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260904012000_whatsapp_retry_lineage.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260904012000_whatsapp_retry_lineage.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(
  sql,
  /alter\s+table\s+public\.whatsapp_messages[\s\S]*add\s+column\s+retry_of_message_id\s+uuid[\s\S]*references\s+public\.whatsapp_messages\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i,
  'retry_of_message_id must be an append-only self-reference with delete restrict.',
);

assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.claim_tux_whatsapp_retry_intent_v1\s*\([\s\S]*p_failed_message_id\s+uuid[\s\S]*\)/i,
  'claim_tux_whatsapp_retry_intent_v1 with p_failed_message_id is missing.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_retry_intent_v1[\s\S]*resolve_tux_whatsapp_current_operator_v1/i,
  'retry claim must resolve Current Operator authority server-side.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_retry_intent_v1[\s\S]*from\s+public\.devices[\s\S]*device\.shop_id\s*=\s*p_shop_id[\s\S]*device\.active/i,
  'retry claim must resolve active device authority in the same shop.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_retry_intent_v1[\s\S]*where\s+message\.shop_id\s*=\s*p_shop_id[\s\S]*message\.id\s*=\s*p_failed_message_id/i,
  'retry source lookup must be fenced to the resolved shop.',
);
assert.match(
  sql,
  /v_failed\.direction\s*<>\s*'OUTBOUND'[\s\S]*v_failed\.status\s*<>\s*'FAILED'[\s\S]*TUX_WHATSAPP_RETRY_NOT_ALLOWED/i,
  'retry claim must reject every non-FAILED or non-outbound source.',
);
assert.match(
  sql,
  /retry_of_message_id[\s\S]*p_failed_message_id/i,
  'retry attempts must persist durable lineage to the failed source.',
);
assert.match(
  sql,
  /on\s+conflict\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)[\s\S]*do\s+nothing/i,
  'retry attempts must remain idempotent by outbound intent key.',
);
assert.match(
  sql,
  /v_message\.retry_of_message_id\s*<>\s*p_failed_message_id|v_message\.retry_of_message_id\s+is\s+distinct\s+from\s+p_failed_message_id/i,
  'retry replay must verify lineage instead of accepting a mismatched intent.',
);
assert.match(
  sql,
  /TUX_WHATSAPP_MEDIA_EXPIRED/i,
  'binary retry must fail closed when canonical media is expired or deleted.',
);

for (const functionName of [
  'claim_tux_whatsapp_retry_intent_v1',
  'get_tux_whatsapp_retry_source_v1',
  'get_tux_whatsapp_media_access_v1',
]) {
  const escaped = functionName.replaceAll('_', '\\_');
  assert.match(
    sql,
    new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
      'i',
    ),
    `${functionName} must revoke client execution.`,
  );
  assert.match(
    sql,
    new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}[\\s\\S]*?to\\s+service_role`,
      'i',
    ),
    `${functionName} must be service-role-only.`,
  );
}

assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.claim_tux_whatsapp_outbound_intent_v2/i,
  'the canonical v2 claim must be extended append-only for durable private media metadata.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_outbound_intent_v2[\s\S]*insert\s+into\s+public\.whatsapp_media_objects/i,
  'normal binary sends must bind the canonical private media object through v2.',
);
assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function\s+public\.claim_tux_whatsapp_outbound_(?:media|location)_v1/i,
  'separate normal-send media/location claim RPCs are forbidden by finalization authority.',
);
assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.get_tux_whatsapp_inbox_v2[\s\S]*media\.media_key\s*=\s*message\.media_ref/i,
  'inbox v2 must resolve shared retry media from the canonical media_ref.',
);
assert.match(
  sql,
  /get_tux_whatsapp_media_access_v1[\s\S]*media\.media_key\s*=\s*message\.media_ref/i,
  'media access must resolve original and retry messages through canonical media_ref.',
);
assert.doesNotMatch(sql, /storage\/v1\/object\/public|getPublicUrl|provider_download_url/i);

const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(databaseUrl, 'TEST_DATABASE_URL is required for retry-lineage behavioral smoke.');
const databaseHost = new URL(databaseUrl).hostname;
assert.ok(
  new Set(['127.0.0.1', 'localhost', '::1']).has(databaseHost),
  'Retry-lineage behavioral smoke refuses a non-loopback PostgreSQL database.',
);

function psql(statement, label) {
  const result = spawnSync(
    'psql',
    [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

psql(
  `insert into public.shops(id, name, active) values
     ('81000000-0000-4000-8000-000000000001', 'Retry Smoke A', true),
     ('81000000-0000-4000-8000-000000000002', 'Retry Smoke B', true);

   insert into public.workers(id, shop_id, display_name, pin_hash, active) values
     ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Retry Worker A', 'hash-a', true),
     ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Retry Worker B', 'hash-b', true);

   insert into public.devices(id, shop_id, label, active) values
     ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Retry Device A', true),
     ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Retry Device B', true),
     ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'Retry Device A Alt', true);

   insert into public.business_days(id, shop_id, status, started_at, started_by_worker_id) values
     ('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'OPEN', now() - interval '1 hour', '82000000-0000-4000-8000-000000000001'),
     ('84000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'OPEN', now() - interval '1 hour', '82000000-0000-4000-8000-000000000002');

   insert into public.worker_sessions(id, shop_id, business_day_id, worker_id, device_id, started_at) values
     ('85000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
     ('85000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', now() - interval '1 hour');

   insert into public.whatsapp_conversations(id, shop_id, normalized_phone, display_phone) values
     ('86000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '01012345678', '+201012345678'),
     ('86000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', '01112345678', '+201112345678');

   insert into public.whatsapp_messages(
     id, shop_id, conversation_id, outbound_intent_key, direction, kind, text, media_ref,
     media_metadata, status, sent_by_worker_id, initiated_by_device_id, initiated_at
   ) values
     ('87000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'failed-text-source', 'OUTBOUND', 'TEXT', 'Retry text', null, '{}'::jsonb, 'FAILED', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', now() - interval '10 minutes'),
     ('87000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'pending-text-source', 'OUTBOUND', 'TEXT', 'Pending text', null, '{}'::jsonb, 'PENDING', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', now() - interval '5 minutes'),
     ('87000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', '86000000-0000-4000-8000-000000000002', 'cross-shop-source', 'OUTBOUND', 'TEXT', 'Other shop', null, '{}'::jsonb, 'FAILED', '82000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000002', now() - interval '10 minutes'),
     ('87000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'failed-image-available', 'OUTBOUND', 'IMAGE', null, 'retry-media-available', '{}'::jsonb, 'FAILED', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', now() - interval '10 minutes'),
     ('87000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 'failed-image-expired', 'OUTBOUND', 'IMAGE', null, 'retry-media-expired', '{}'::jsonb, 'FAILED', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', now() - interval '10 minutes');

   insert into public.whatsapp_media_objects(
     media_key, shop_id, message_id, kind, bucket_id, object_path, mime_type, file_name,
     byte_size, sha256, provider_media_id, stored_at, expires_at, deleted_at
   ) values
     ('retry-media-available', '81000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000004', 'IMAGE', 'tux-whatsapp-media', 'media/81000000-0000-4000-8000-000000000001/retry-media-available', 'image/png', 'available.png', 4, 'sha-a', null, now() - interval '20 days', now() + interval '10 days', null),
     ('retry-media-expired', '81000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000005', 'IMAGE', 'tux-whatsapp-media', 'media/81000000-0000-4000-8000-000000000001/retry-media-expired', 'image/png', 'expired.png', 4, 'sha-b', null, now() - interval '31 days', now() - interval '1 day', null);

   do $$
   declare
     v_first record;
     v_replay record;
     v_binary record;
     v_normal record;
     v_access record;
     v_retry_id uuid;
     v_binary_retry_id uuid;
     v_normal_id uuid;
     v_inbox jsonb;
   begin
     select * into v_normal
     from public.claim_tux_whatsapp_outbound_intent_v2(
       '81000000-0000-4000-8000-000000000001',
       '84000000-0000-4000-8000-000000000001',
       '82000000-0000-4000-8000-000000000001',
       '83000000-0000-4000-8000-000000000001',
       '86000000-0000-4000-8000-000000000001',
       'normal-media-v2',
       'IMAGE',
       null,
       'normal-media-v2',
       jsonb_build_object(
         'media_key', 'normal-media-v2',
         'object_path', 'media/81000000-0000-4000-8000-000000000001/normal-media-v2',
         'mime_type', 'image/png',
         'file_name', 'normal.png',
         'byte_size', 4,
         'sha256', 'sha-normal',
         'stored_at', now() - interval '1 day',
         'expires_at', now() + interval '29 days'
       ),
       now()
     );
     v_normal_id := (v_normal.message_json ->> 'id')::uuid;
     if not v_normal.created or not exists (
       select 1 from public.whatsapp_media_objects media
       where media.shop_id = '81000000-0000-4000-8000-000000000001'
         and media.message_id = v_normal_id
         and media.media_key = 'normal-media-v2'
     ) then
       raise exception 'canonical v2 binary claim did not bind private media metadata';
     end if;

     select * into v_first
     from public.claim_tux_whatsapp_retry_intent_v1(
       '81000000-0000-4000-8000-000000000001',
       '84000000-0000-4000-8000-000000000001',
       '82000000-0000-4000-8000-000000000001',
       '83000000-0000-4000-8000-000000000001',
       '87000000-0000-4000-8000-000000000001',
       'retry-text-attempt-1',
       now()
     );
     v_retry_id := (v_first.message_json ->> 'id')::uuid;
     if not v_first.created then
       raise exception 'first retry attempt was not created';
     end if;
     if not exists (
       select 1 from public.whatsapp_messages message
       where message.id = v_retry_id
         and message.shop_id = '81000000-0000-4000-8000-000000000001'
         and message.retry_of_message_id = '87000000-0000-4000-8000-000000000001'
         and message.status = 'PENDING'
         and message.text = 'Retry text'
         and message.sent_by_worker_id = '82000000-0000-4000-8000-000000000001'
         and message.initiated_by_device_id = '83000000-0000-4000-8000-000000000001'
     ) then
       raise exception 'retry lineage or copied text authority is incorrect';
     end if;

     select * into v_replay
     from public.claim_tux_whatsapp_retry_intent_v1(
       '81000000-0000-4000-8000-000000000001',
       '84000000-0000-4000-8000-000000000001',
       '82000000-0000-4000-8000-000000000001',
       '83000000-0000-4000-8000-000000000001',
       '87000000-0000-4000-8000-000000000001',
       'retry-text-attempt-1',
       now() + interval '1 minute'
     );
     if v_replay.created or (v_replay.message_json ->> 'id')::uuid <> v_retry_id then
       raise exception 'retry replay was not idempotent';
     end if;

     begin
       perform 1 from public.claim_tux_whatsapp_retry_intent_v1(
         '81000000-0000-4000-8000-000000000001',
         '84000000-0000-4000-8000-000000000001',
         '82000000-0000-4000-8000-000000000001',
         '83000000-0000-4000-8000-000000000003',
         '87000000-0000-4000-8000-000000000001',
         'retry-text-attempt-1',
         now()
       );
       raise exception 'authority-mismatched retry replay unexpectedly succeeded';
     exception when others then
       if sqlerrm = 'authority-mismatched retry replay unexpectedly succeeded' then raise; end if;
       if position('TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT' in sqlerrm) = 0 then
         raise exception 'unexpected authority replay error: %', sqlerrm;
       end if;
     end;

     begin
       perform 1 from public.claim_tux_whatsapp_retry_intent_v1(
         '81000000-0000-4000-8000-000000000001',
         '84000000-0000-4000-8000-000000000001',
         '82000000-0000-4000-8000-000000000001',
         '83000000-0000-4000-8000-000000000001',
         '87000000-0000-4000-8000-000000000002',
         'retry-pending-disallowed',
         now()
       );
       raise exception 'PENDING retry unexpectedly succeeded';
     exception when others then
       if sqlerrm = 'PENDING retry unexpectedly succeeded' then raise; end if;
       if position('TUX_WHATSAPP_RETRY_NOT_ALLOWED' in sqlerrm) = 0 then
         raise exception 'unexpected PENDING retry error: %', sqlerrm;
       end if;
     end;

     begin
       perform 1 from public.claim_tux_whatsapp_retry_intent_v1(
         '81000000-0000-4000-8000-000000000001',
         '84000000-0000-4000-8000-000000000001',
         '82000000-0000-4000-8000-000000000001',
         '83000000-0000-4000-8000-000000000001',
         '87000000-0000-4000-8000-000000000003',
         'retry-cross-shop-disallowed',
         now()
       );
       raise exception 'cross-shop retry unexpectedly succeeded';
     exception when others then
       if sqlerrm = 'cross-shop retry unexpectedly succeeded' then raise; end if;
       if position('TUX_WHATSAPP_RETRY_NOT_ALLOWED' in sqlerrm) = 0 then
         raise exception 'unexpected cross-shop retry error: %', sqlerrm;
       end if;
     end;

     select * into v_binary
     from public.claim_tux_whatsapp_retry_intent_v1(
       '81000000-0000-4000-8000-000000000001',
       '84000000-0000-4000-8000-000000000001',
       '82000000-0000-4000-8000-000000000001',
       '83000000-0000-4000-8000-000000000001',
       '87000000-0000-4000-8000-000000000004',
       'retry-image-attempt-1',
       now()
     );
     v_binary_retry_id := (v_binary.message_json ->> 'id')::uuid;
     if not v_binary.created or v_binary.media_json ->> 'media_key' <> 'retry-media-available' then
       raise exception 'available binary retry did not reuse canonical media';
     end if;

     select * into v_access
     from public.get_tux_whatsapp_media_access_v1(
       '81000000-0000-4000-8000-000000000001',
       v_binary_retry_id
     );
     if v_access.object_path <> 'media/81000000-0000-4000-8000-000000000001/retry-media-available' then
       raise exception 'retry media access did not resolve through canonical media_ref';
     end if;

     select public.get_tux_whatsapp_inbox_v2(
       '81000000-0000-4000-8000-000000000001',
       null
     ) into v_inbox;
     if not exists (
       select 1
       from jsonb_array_elements(v_inbox -> 'messages') item
       where item ->> 'id' = v_binary_retry_id::text
         and item #>> '{media,mediaKey}' = 'retry-media-available'
     ) then
       raise exception 'retry media was not projected from canonical media_ref';
     end if;

     begin
       perform 1 from public.claim_tux_whatsapp_retry_intent_v1(
         '81000000-0000-4000-8000-000000000001',
         '84000000-0000-4000-8000-000000000001',
         '82000000-0000-4000-8000-000000000001',
         '83000000-0000-4000-8000-000000000001',
         '87000000-0000-4000-8000-000000000005',
         'retry-image-expired',
         now()
       );
       raise exception 'expired binary retry unexpectedly succeeded';
     exception when others then
       if sqlerrm = 'expired binary retry unexpectedly succeeded' then raise; end if;
       if position('TUX_WHATSAPP_MEDIA_EXPIRED' in sqlerrm) = 0 then
         raise exception 'unexpected expired media retry error: %', sqlerrm;
       end if;
     end;
   end $$;`,
  'WhatsApp retry-lineage behavioral smoke',
);

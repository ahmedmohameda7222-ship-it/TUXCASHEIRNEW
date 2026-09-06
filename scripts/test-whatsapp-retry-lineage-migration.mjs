import assert from 'node:assert/strict';
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

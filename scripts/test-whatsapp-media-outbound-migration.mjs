import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260904012000_whatsapp_media_outbound.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260904012000_whatsapp_media_outbound.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(
  sql,
  /alter\s+table\s+public\.whatsapp_messages[\s\S]*retry_of_message_id\s+uuid/i,
  'retry_of_message_id durable lineage column is missing.',
);
assert.match(
  sql,
  /foreign\s+key\s*\(\s*shop_id\s*,\s*retry_of_message_id\s*\)[\s\S]*references\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*id\s*\)\s+on\s+delete\s+restrict/i,
  'retry lineage must be same-shop and non-cascading.',
);
assert.match(
  sql,
  /retry_of_message_id\s+is\s+null\s+or\s+direction\s*=\s*'OUTBOUND'/i,
  'retry lineage must be outbound-only.',
);

const functions = [
  'claim_tux_whatsapp_outbound_media_v1',
  'claim_tux_whatsapp_outbound_location_v1',
  'get_tux_whatsapp_retry_source_v1',
  'claim_tux_whatsapp_retry_intent_v1',
  'get_tux_whatsapp_media_access_v1',
];

for (const functionName of functions) {
  const escaped = functionName.replaceAll('_', '\\_');
  assert.match(
    sql,
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${escaped}\\b`, 'i'),
    `${functionName} is missing.`,
  );
  assert.match(
    sql,
    new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
      'i',
    ),
    `${functionName} must revoke public/anon/authenticated execution.`,
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

assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.doesNotMatch(
  sql,
  /grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i,
  'outbound WhatsApp RPCs must not be client-executable.',
);

assert.match(
  sql,
  /claim_tux_whatsapp_outbound_media_v1[\s\S]*resolve_tux_whatsapp_current_operator_v1/i,
  'media claim must resolve current worker authority server-side.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_outbound_media_v1[\s\S]*insert\s+into\s+public\.whatsapp_media_objects/i,
  'media claim must durably bind canonical media metadata.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_outbound_location_v1[\s\S]*resolve_tux_whatsapp_current_operator_v1/i,
  'location claim must resolve current worker authority server-side.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_retry_intent_v1[\s\S]*status\s*<>\s*'FAILED'[\s\S]*TUX_WHATSAPP_RETRY_NOT_ALLOWED/i,
  'retry claim must fail closed for non-FAILED delivery states.',
);
assert.match(
  sql,
  /claim_tux_whatsapp_retry_intent_v1[\s\S]*retry_of_message_id[\s\S]*p_message_id/i,
  'retry claim must persist a link to the failed source attempt.',
);
assert.match(
  sql,
  /get_tux_whatsapp_media_access_v1[\s\S]*media\.media_key\s*=\s*message\.media_ref/i,
  'media access must resolve canonical media by media_ref so retries can reuse it safely.',
);
assert.match(
  sql,
  /create\s+or\s+replace\s+function\s+public\.get_tux_whatsapp_inbox_v2[\s\S]*media\.media_key\s*=\s*message\.media_ref/i,
  'inbox v2 must materialize retry media through the canonical media_ref.',
);
assert.doesNotMatch(sql, /storage\/v1\/object\/public|getPublicUrl|provider_download_url/i);

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260904011000_whatsapp_media_storage.sql');
const materializationMigrationPath = resolve(
  'supabase/migrations/20260904011500_whatsapp_media_materialization.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260904011000_whatsapp_media_storage.sql is missing.',
);
assert.equal(
  existsSync(materializationMigrationPath),
  true,
  '20260904011500_whatsapp_media_materialization.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');
const materializationSql = readFileSync(materializationMigrationPath, 'utf8');
const inboxV2 =
  sql.match(
    /create\s+or\s+replace\s+function\s+public\.get_tux_whatsapp_inbox_v2[\s\S]*?(?=revoke\s+all\s+on\s+function\s+public\.get_tux_whatsapp_inbox_v2)/i,
  )?.[0] ?? '';
const listExpired =
  sql.match(
    /create\s+or\s+replace\s+function\s+public\.list_tux_whatsapp_expired_media_v1[\s\S]*?(?=revoke\s+all\s+on\s+function\s+public\.list_tux_whatsapp_expired_media_v1)/i,
  )?.[0] ?? '';
const markDeleted =
  sql.match(
    /create\s+or\s+replace\s+function\s+public\.mark_tux_whatsapp_media_deleted_v1[\s\S]*?(?=revoke\s+all\s+on\s+function\s+public\.mark_tux_whatsapp_media_deleted_v1|$)/i,
  )?.[0] ?? '';
const materializeInboundV2 =
  materializationSql.match(
    /create\s+or\s+replace\s+function\s+public\.materialize_tux_whatsapp_inbound_v2[\s\S]*?(?=revoke\s+all\s+on\s+function\s+public\.materialize_tux_whatsapp_inbound_v2)/i,
  )?.[0] ?? '';

assert.match(sql, /insert\s+into\s+storage\.buckets[\s\S]*tux-whatsapp-media/i);
assert.match(
  sql,
  /insert\s+into\s+storage\.buckets\s*\(\s*id\s*,\s*name\s*,\s*public\s*\)[\s\S]*values\s*\(\s*'tux-whatsapp-media'\s*,\s*'tux-whatsapp-media'\s*,\s*false\s*\)/i,
);
assert.match(sql, /on\s+conflict\s*\(\s*id\s*\)[\s\S]*public\s*=\s*false/i);

assert.match(sql, /create\s+table\s+public\.whatsapp_media_objects/i);
for (const column of [
  'media_key',
  'shop_id',
  'message_id',
  'kind',
  'bucket_id',
  'object_path',
  'mime_type',
  'file_name',
  'byte_size',
  'sha256',
  'provider_media_id',
  'stored_at',
  'expires_at',
  'deleted_at',
]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'));
}
assert.match(sql, /kind[\s\S]*check[\s\S]*(?:IMAGE|DOCUMENT|AUDIO)/i);
assert.match(sql, /byte_size[\s\S]*check[\s\S]*>=\s*0/i);
assert.match(sql, /unique[\s\S]*\(\s*shop_id\s*,\s*message_id\s*\)/i);
assert.match(sql, /unique[\s\S]*\(\s*bucket_id\s*,\s*object_path\s*\)/i);
assert.match(
  sql,
  /foreign\s+key\s*\(\s*shop_id\s*,\s*message_id\s*\)[\s\S]*references\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*id\s*\)\s+on\s+delete\s+restrict/i,
);
assert.match(
  sql,
  /check\s*\(\s*expires_at\s*=\s*stored_at\s*\+\s*interval\s+'30\s+days'\s*\)/i,
);
assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(
  sql,
  /revoke\s+all\s+on\s+table\s+public\.whatsapp_media_objects\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.doesNotMatch(
  sql,
  /grant\s+(?:select|insert|update|delete|all)[\s\S]*public\.whatsapp_media_objects[\s\S]*to\s+(?:anon|authenticated)/i,
);

assert.notEqual(inboxV2, '', 'get_tux_whatsapp_inbox_v2 is missing.');
assert.match(inboxV2, /'media'[\s\S]*'mediaKey'[\s\S]*'availability'/i);
assert.match(
  inboxV2,
  /deleted_at\s+is\s+not\s+null\s+or\s+media\.expires_at\s*<=\s*now\s*\(\s*\)/i,
);
assert.match(
  inboxV2,
  /'location'[\s\S]*'latitude'[\s\S]*'longitude'[\s\S]*'name'[\s\S]*'address'/i,
);
for (const forbidden of [
  'provider_media_id',
  'bucket_id',
  'object_path',
  'signed_url',
  'signed_access_url',
  'provider_download_url',
  'service_role_key',
]) {
  assert.doesNotMatch(inboxV2, new RegExp(`\\b${forbidden}\\b`, 'i'));
}
assert.match(
  sql,
  /revoke\s+all\s+on\s+function\s+public\.get_tux_whatsapp_inbox_v2\s*\(\s*uuid\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.get_tux_whatsapp_inbox_v2\s*\(\s*uuid\s*,\s*text\s*\)\s+to\s+service_role/i,
);

assert.notEqual(listExpired, '', 'list_tux_whatsapp_expired_media_v1 is missing.');
assert.match(listExpired, /deleted_at\s+is\s+null/i);
assert.match(listExpired, /expires_at\s*<=\s*p_now/i);
assert.match(listExpired, /order\s+by[\s\S]*expires_at[\s\S]*media_key/i);
assert.match(listExpired, /limit\s+least\s*\([\s\S]*p_limit[\s\S]*100/i);
assert.match(
  sql,
  /revoke\s+all\s+on\s+function\s+public\.list_tux_whatsapp_expired_media_v1\s*\(\s*timestamptz\s*,\s*integer\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.list_tux_whatsapp_expired_media_v1\s*\(\s*timestamptz\s*,\s*integer\s*\)\s+to\s+service_role/i,
);

assert.notEqual(markDeleted, '', 'mark_tux_whatsapp_media_deleted_v1 is missing.');
assert.match(
  markDeleted,
  /set\s+deleted_at\s*=\s*coalesce\s*\(\s*deleted_at\s*,\s*p_deleted_at\s*\)/i,
);
assert.doesNotMatch(markDeleted, /delete\s+from\s+public\.whatsapp_messages/i);
assert.match(
  sql,
  /revoke\s+all\s+on\s+function\s+public\.mark_tux_whatsapp_media_deleted_v1\s*\(\s*text\s*,\s*timestamptz\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.mark_tux_whatsapp_media_deleted_v1\s*\(\s*text\s*,\s*timestamptz\s*\)\s+to\s+service_role/i,
);

assert.doesNotMatch(sql, /materialize_tux_whatsapp_inbound_v2/i);
assert.notEqual(materializeInboundV2, '', 'materialize_tux_whatsapp_inbound_v2 is missing.');
assert.match(materializeInboundV2, /p_kind\s+not\s+in\s*\(\s*'IMAGE'\s*,\s*'DOCUMENT'\s*,\s*'AUDIO'\s*\)/i);
assert.match(materializeInboundV2, /p_bucket_id\s*<>\s*'tux-whatsapp-media'/i);
assert.match(
  materializeInboundV2,
  /p_object_path\s*<>\s*'media\/'\s*\|\|\s*p_shop_id::text\s*\|\|\s*'\/'\s*\|\|\s*p_media_key/i,
);
assert.match(
  materializeInboundV2,
  /p_expires_at\s*<>\s*p_stored_at\s*\+\s*interval\s+'30\s+days'/i,
);
assert.match(
  materializeInboundV2,
  /where\s+message\.shop_id\s*=\s*p_shop_id[\s\S]*message\.provider_message_id\s*=\s*p_provider_message_id/i,
);
assert.match(materializeInboundV2, /message\.media_ref\s*=\s*p_media_key/i);
assert.match(materializeInboundV2, /media\.provider_media_id\s*=\s*p_provider_media_id/i);
assert.match(
  materializeInboundV2,
  /insert\s+into\s+public\.whatsapp_media_objects[\s\S]*p_provider_media_id[\s\S]*p_stored_at[\s\S]*p_expires_at/i,
);
assert.match(
  materializeInboundV2,
  /set\s+unread_count\s*=\s*conversation\.unread_count\s*\+\s*1/i,
);
assert.match(
  materializeInboundV2,
  /if\s+v_message_id\s+is\s+not\s+null[\s\S]*return\s+query[\s\S]*false/i,
);
assert.doesNotMatch(materializeInboundV2, /provider_download_url|signed_url|service_role_key/i);
assert.match(materializationSql, /security\s+definer/i);
assert.match(
  materializationSql,
  /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i,
);
assert.match(
  materializationSql,
  /revoke\s+all\s+on\s+function\s+public\.materialize_tux_whatsapp_inbound_v2[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i,
);
assert.match(
  materializationSql,
  /grant\s+execute\s+on\s+function\s+public\.materialize_tux_whatsapp_inbound_v2[\s\S]*to\s+service_role/i,
);
assert.doesNotMatch(
  materializationSql,
  /grant\s+execute[\s\S]*materialize_tux_whatsapp_inbound_v2[\s\S]*to\s+(?:anon|authenticated)/i,
);

assert.doesNotMatch(sql, /delete\s+from\s+public\.whatsapp_messages/i);
assert.doesNotMatch(materializationSql, /delete\s+from\s+public\.whatsapp_messages/i);
assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.doesNotMatch(
  sql,
  /grant\s+execute[\s\S]*on\s+function\s+public\.(?:get_tux_whatsapp_inbox_v2|list_tux_whatsapp_expired_media_v1|mark_tux_whatsapp_media_deleted_v1)[\s\S]*to\s+(?:anon|authenticated)/i,
);

const migrationHarness = readFileSync(resolve('scripts/test-migrations.mjs'), 'utf8');
assert.match(migrationHarness, /drop\s+schema\s+if\s+exists\s+storage\s+cascade/i);
assert.match(migrationHarness, /create\s+schema\s+storage/i);
assert.match(
  migrationHarness,
  /create\s+table\s+storage\.buckets\s*\([\s\S]*id\s+text\s+primary\s+key[\s\S]*name\s+text\s+not\s+null\s+unique[\s\S]*public\s+boolean\s+not\s+null\s+default\s+false[\s\S]*\)/i,
);
assert.doesNotMatch(migrationHarness, /create\s+table\s+storage\.(?:objects|migrations|prefixes)/i);

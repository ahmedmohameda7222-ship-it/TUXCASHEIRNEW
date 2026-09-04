import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/20260904011000_whatsapp_media_storage.sql');

assert.equal(
  existsSync(migrationPath),
  true,
  '20260904011000_whatsapp_media_storage.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /insert\s+into\s+storage\.buckets[\s\S]*tux-whatsapp-media/i);
assert.match(sql, /tux-whatsapp-media[\s\S]*false/i);

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
assert.match(sql, /expires_at[\s\S]*stored_at[\s\S]*interval\s+'30\s+days'/i);
assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.whatsapp_media_objects/i);

assert.match(sql, /get_tux_whatsapp_inbox_v2/i);
assert.match(sql, /availability[\s\S]*deleted_at[\s\S]*expires_at[\s\S]*now\s*\(\s*\)/i);
for (const forbidden of [
  'provider_media_id',
  'bucket_id',
  'object_path',
  'signed_url',
]) {
  const inboxV2 = sql.match(/create\s+or\s+replace\s+function\s+public\.get_tux_whatsapp_inbox_v2[\s\S]*?(?=create\s+or\s+replace\s+function|revoke\s+all\s+on\s+function|$)/i)?.[0] ?? '';
  assert.doesNotMatch(inboxV2, new RegExp(`['\"]${forbidden}['\"]\\s*:`, 'i'));
}

assert.match(sql, /list_tux_whatsapp_expired_media_v1/i);
assert.match(sql, /deleted_at\s+is\s+null/i);
assert.match(sql, /expires_at\s*<=\s*p_now/i);
assert.match(sql, /order\s+by[\s\S]*expires_at[\s\S]*media_key/i);
assert.match(sql, /least\s*\([\s\S]*p_limit[\s\S]*100/i);
assert.match(sql, /mark_tux_whatsapp_media_deleted_v1/i);
assert.match(sql, /set\s+deleted_at\s*=\s*coalesce\s*\(\s*deleted_at\s*,\s*p_deleted_at\s*\)/i);
assert.doesNotMatch(sql, /delete\s+from\s+public\.whatsapp_messages/i);

assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.match(sql, /revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);
assert.doesNotMatch(sql, /grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i);

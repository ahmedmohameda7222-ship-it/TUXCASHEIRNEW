import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260904010000_whatsapp_messaging_policy.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260904010000_whatsapp_messaging_policy.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /create\s+table\s+public\.whatsapp_shop_messaging_config/i);
assert.match(sql, /storefront_url\s+text\s+not\s+null/i);
assert.match(sql, /store_latitude\s+double\s+precision/i);
assert.match(sql, /store_longitude\s+double\s+precision/i);
assert.match(sql, /store_location_label\s+text/i);
assert.match(sql, /store_location_address\s+text/i);
assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.whatsapp_shop_messaging_config/i);

assert.match(sql, /create\s+table\s+public\.whatsapp_starter_templates/i);
assert.match(sql, /provider_status\s+text\s+not\s+null[\s\S]*provider_status\s*=\s*'APPROVED'/i);
assert.match(sql, /active\s+boolean\s+not\s+null\s+default\s+true/i);
assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.whatsapp_starter_templates/i);
assert.match(
  sql,
  /create\s+unique\s+index[\s\S]*whatsapp_starter_templates[\s\S]*channel_id[\s\S]*provider_template_name[\s\S]*language_code[\s\S]*where\s+active/i,
);

assert.match(sql, /get_tux_whatsapp_messaging_policy_v1/i);
assert.match(sql, /get_tux_whatsapp_contact_target_v1/i);
assert.match(sql, /claim_tux_whatsapp_template_intent_v1/i);
assert.match(sql, /interval\s+'24\s+hours'/i);
assert.match(sql, /provider_status\s*=\s*'APPROVED'/i);
assert.match(sql, /shop_id\s*=\s*p_shop_id/i);
assert.match(sql, /on\s+conflict\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i);
assert.match(sql, /resolve_tux_whatsapp_current_operator_v1/i);
assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.match(sql, /revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);
assert.doesNotMatch(sql, /grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i);

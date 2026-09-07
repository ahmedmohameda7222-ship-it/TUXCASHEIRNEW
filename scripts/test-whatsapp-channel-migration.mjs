import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902223000_whatsapp_channels.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902223000_whatsapp_channels.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /create\s+table\s+public\.whatsapp_channels/i);
assert.match(sql, /provider\s+text\s+not\s+null/i);
assert.match(sql, /provider_phone_number_id\s+text\s+not\s+null/i);
assert.match(sql, /active\s+boolean\s+not\s+null\s+default\s+true/i);

assert.match(
  sql,
  /unique\s*\(\s*provider\s*,\s*provider_phone_number_id\s*\)/i,
  'provider identity must resolve to one channel row globally.',
);

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_channels_one_active_per_shop\s+on\s+public\.whatsapp_channels\s*\(\s*shop_id\s*\)\s+where\s+active\s*(?:=\s*true)?\s*;/i,
  'v1 must allow at most one active WhatsApp channel per shop.',
);

assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.whatsapp_channels/i);
assert.match(sql, /resolve_tux_whatsapp_inbound_channel_v1/i);
assert.match(sql, /resolve_tux_whatsapp_outbound_channel_v1/i);
assert.match(sql, /security\s+definer/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);

assert.doesNotMatch(
  sql,
  /TUX_WHATSAPP_SHOP_ID/i,
  'tenant resolution must not be encoded as a deployment shop variable.',
);

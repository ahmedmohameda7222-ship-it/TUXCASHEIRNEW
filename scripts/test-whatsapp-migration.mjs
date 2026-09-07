import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902220000_whatsapp_inbox.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902220000_whatsapp_inbox.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

for (const table of [
  'whatsapp_conversations',
  'whatsapp_messages',
  'whatsapp_quick_replies',
  'whatsapp_conversation_order_links',
]) {
  assert.match(sql, new RegExp(`\\b${table}\\b`, 'i'));
}

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_messages_provider_message_unique\s+on\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*provider_message_id\s*\)\s+where\s+provider_message_id\s+is\s+not\s+null\s*;/i,
  'provider-message idempotency must use the required partial unique index.',
);

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_messages_outbound_intent_unique\s+on\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)\s+where\s+outbound_intent_key\s+is\s+not\s+null\s*;/i,
  'outbound-intent idempotency must use the required partial unique index.',
);

assert.doesNotMatch(
  sql,
  /\bunique\s*\(\s*shop_id\s*,\s*provider_message_id\s*\)/i,
  'Do not add a redundant table-level provider_message_id unique constraint.',
);

assert.doesNotMatch(
  sql,
  /\bunique\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i,
  'Do not add a redundant table-level outbound_intent_key unique constraint.',
);

assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all/i);

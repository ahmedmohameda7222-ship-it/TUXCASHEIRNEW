import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902224500_whatsapp_current_worker_authority.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');
const resolverSignature = sql.match(
  /resolve_tux_whatsapp_current_operator_v1\s*\(([^)]*)\)/i,
)?.[1] ?? '';

assert.match(resolverSignature, /p_shop_id\s+uuid/i);
assert.match(resolverSignature, /p_business_day_id\s+uuid/i);
assert.match(resolverSignature, /p_claimed_worker_id\s+uuid/i);
assert.doesNotMatch(resolverSignature, /p_device_id/i);

assert.match(sql, /business_day\.status\s*=\s*'OPEN'/i);
assert.match(sql, /worker_session\.ended_at\s+is\s+null/i);
assert.match(sql, /worker_session\.worker_id\s*=\s*p_claimed_worker_id/i);
assert.match(sql, /worker\.active/i);
assert.match(sql, /shop\.active/i);
assert.match(sql, /claim_tux_whatsapp_outbound_intent_v2/i);
assert.match(sql, /for\s+share\s+of\s+shop\s*,\s*business_day\s*,\s*worker_session\s*,\s*worker/i);
assert.match(sql, /TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED/i);
assert.match(sql, /TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT/i);
assert.match(sql, /on\s+conflict\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i);
assert.match(sql, /recipient_normalized_phone/i);
assert.match(sql, /fail_tux_whatsapp_outbound_intent_v1/i);
assert.match(sql, /link_tux_whatsapp_conversation_order_authorized_v1/i);
assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.match(sql, /revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);
assert.doesNotMatch(sql, /TUX_WHATSAPP_SHOP_ID/i);
assert.doesNotMatch(sql, /TUX_WHATSAPP_WORKER_ID/i);

import { readFileSync } from 'node:fs';

const cliPath = 'scripts/bootstrap-admin-owner.mjs';
const migrationPath = 'supabase/migrations/20260910100000_admin_business_auth.sql';
const cli = readFileSync(cliPath, 'utf8');
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

for (const required of [
  'bootstrap_tux_admin_owner_v1',
  'pg_advisory_xact_lock',
  "role = 'owner'",
  'to service_role',
]) {
  if (!sql.includes(required)) throw new Error(`missing bootstrap migration invariant: ${required}`);
}

if (!/revoke\s+(?:all|execute)\s+on\s+function\s+public\.bootstrap_tux_admin_owner_v1[\s\S]*?from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)) {
  throw new Error('OWNER bootstrap RPC must revoke browser/public execution');
}
if (!/grant\s+execute\s+on\s+function\s+public\.bootstrap_tux_admin_owner_v1[\s\S]*?to\s+service_role/i.test(sql)) {
  throw new Error('OWNER bootstrap RPC must be service-role only');
}

for (const required of [
  'setRawMode',
  'pbkdf2-sha256',
  '210_000',
  'bootstrap_tux_admin_owner_v1',
  'TUX_ADMIN_PIN_LOOKUP_SECRET',
]) {
  if (!cli.includes(required)) throw new Error(`missing secure bootstrap CLI behavior: ${required}`);
}

if (/--pin(?:\s|=)/i.test(cli)) throw new Error('bootstrap CLI must never accept the PIN as a command argument');
if (/console\.(?:log|error|warn)\s*\(\s*pin\b/i.test(cli)) {
  throw new Error('bootstrap CLI must never print the entered PIN');
}
if (/JSON\.stringify\s*\(\s*\{[\s\S]{0,500}\bpin\s*[,}:]/i.test(cli)) {
  throw new Error('bootstrap CLI must submit hashes only, never plaintext PIN');
}
if (/\b(?:pin|defaultPin|ownerPin)\s*=\s*['"]\d{4,12}['"]/i.test(cli)) {
  throw new Error('bootstrap CLI must not contain a literal/default production PIN');
}

console.log('Admin OWNER bootstrap invariants passed.');

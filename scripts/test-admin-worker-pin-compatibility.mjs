import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('apps/admin/server/pin.ts', 'utf8');
const edge = fs.readFileSync('supabase/functions/worker-auth/index.ts', 'utf8');
const desktop = fs.readFileSync('apps/operations-desktop/src/main/pinVerifier.ts', 'utf8');

for (const [source, label] of [
  [admin, 'Admin PIN'],
  [edge, 'Operations Edge worker PIN'],
  [desktop, 'Operations desktop worker PIN'],
]) {
  assert.match(source, /pbkdf2-sha256/, `${label} must use the canonical encoded prefix`);
  assert.match(source, /sha256|SHA-256/i, `${label} must use SHA-256 PBKDF2`);
  assert.match(source, /100_000|100000|210_000|210000/, `${label} must reject weak iteration counts`);
}

assert.match(admin, /DERIVED_KEY_BYTES\s*=\s*32/, 'Admin PIN digest must remain 32 bytes');
assert.match(edge, /DERIVED_KEY_BYTES\s*=\s*32/, 'Edge worker PIN digest must remain 32 bytes');
assert.match(desktop, /DERIVED_KEY_BYTES\s*=\s*32/, 'Desktop worker PIN digest must remain 32 bytes');
assert.match(admin, /PIN_PATTERN\s*=\s*\/\^\\d\{4,12\}\$\//, 'Admin PIN format must remain numeric 4-12 digits');
assert.match(edge, /\\d\{4,12\}/, 'Operations worker-auth must accept the same numeric format');
assert.doesNotMatch(
  fs.readFileSync('apps/admin/server/staff/employeePin.ts', 'utf8'),
  /pbkdf2Sync|pbkdf2 as|createHmac/,
  'Workforce PIN flow must reuse the canonical Admin crypto implementation',
);

console.log('Admin/Operations worker PIN compatibility invariants passed.');

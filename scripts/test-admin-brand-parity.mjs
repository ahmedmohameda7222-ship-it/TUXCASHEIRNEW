// Original Operations artwork is the canonical TUX identity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const original = readFileSync('apps/operations/public/favicon.svg');
const admin = readFileSync('apps/admin/public/favicon.svg');
const menu = readFileSync('apps/menu/public/favicon.svg');
assert.deepEqual(admin, original, 'Admin must reuse the exact Operations logo bytes');
assert.deepEqual(menu, original, 'Menu and Operations artwork must remain unchanged');
for (const file of [
  'apps/admin/src/auth/LoginPage.tsx',
  'apps/admin/src/components/shell/DesktopSidebar.tsx',
  'apps/admin/src/components/shell/AdminTopBar.tsx',
]) {
  assert.match(readFileSync(file, 'utf8'), /<BrandLogo\b/, file + ' must display the canonical artwork');
}
assert.match(readFileSync('apps/admin/index.html', 'utf8'), /href="\/favicon\.svg"/);
const manifest = JSON.parse(readFileSync('apps/admin/public/manifest.webmanifest', 'utf8'));
assert.ok(manifest.icons.some((icon) => icon.src === '/favicon.svg' && icon.type === 'image/svg+xml'));
console.log('Canonical logo parity and Admin entrypoints passed.');

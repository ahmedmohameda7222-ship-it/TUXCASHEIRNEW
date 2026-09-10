import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const clientRoot = 'apps/admin/src';
const migrationsRoot = 'supabase/migrations';

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (/\.(?:ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

const forbiddenClientTokens = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'TUX_ADMIN_PIN_LOOKUP_SECRET',
  'TUX_ADMIN_RATE_LIMIT_SECRET',
  'META_ACCESS_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
];

for (const path of walk(clientRoot)) {
  const body = readFileSync(path, 'utf8');
  const display = relative('.', path);
  for (const token of forbiddenClientTokens) {
    if (body.includes(token)) throw new Error(`${token} leaked into client source: ${display}`);
  }
  if (
    /from\s+['"]@supabase\/supabase-js['"]|require\(['"]@supabase\/supabase-js['"]\)/.test(body)
  ) {
    throw new Error(
      `Admin browser source must use the same-origin BFF, not Supabase directly: ${display}`,
    );
  }
  if (/https?:\/\/[^'"\s]+(?:supabase|functions\/v1|rest\/v1)/i.test(body)) {
    throw new Error(`Admin browser source contains a direct backend URL: ${display}`);
  }
  if (/document\.cookie/.test(body)) {
    throw new Error(`Admin browser source must not read the HttpOnly session cookie: ${display}`);
  }
  if (/(?:localStorage|sessionStorage)[\s\S]{0,160}(?:csrf|pin|session)/i.test(body)) {
    throw new Error(`Admin privileged auth material must remain memory-only: ${display}`);
  }
}

const apiClient = readFileSync('apps/admin/src/lib/adminApi.ts', 'utf8');
if (!/credentials:\s*['"]same-origin['"]/.test(apiClient)) {
  throw new Error('Admin API client must send credentials only to the same origin');
}

const vercelConfig = JSON.parse(readFileSync('apps/admin/vercel.json', 'utf8'));
if (vercelConfig.installCommand !== 'cd ../.. && npm ci') {
  throw new Error(
    'Admin Vercel install must resolve the monorepo lockfile from the repository root',
  );
}
if (vercelConfig.buildCommand !== 'cd ../.. && npm run build:admin') {
  throw new Error('Admin Vercel build must use the canonical root Admin workspace command');
}
if (vercelConfig.git?.deploymentEnabled !== false) {
  throw new Error(
    'Automatic Admin Vercel deployments must remain disabled before the Plan 10 release gate',
  );
}
if (!Array.isArray(vercelConfig.routes) || vercelConfig.routes.length < 2) {
  throw new Error('Admin Vercel routing must preserve filesystem routes before the SPA fallback');
}
if (vercelConfig.routes[0]?.handle !== 'filesystem') {
  throw new Error(
    'Admin Vercel routing must resolve API/static filesystem resources before SPA fallback',
  );
}
const lastAdminRoute = vercelConfig.routes.at(-1);
if (lastAdminRoute?.src !== '/(.*)' || lastAdminRoute?.dest !== '/index.html') {
  throw new Error('Admin Vercel routing must end with the Vite SPA deep-link fallback');
}

const adminMigrationPaths = readdirSync(migrationsRoot)
  .filter((name) => /admin.*\.sql$/i.test(name))
  .sort()
  .map((name) => join(migrationsRoot, name));
if (adminMigrationPaths.length === 0) throw new Error('No canonical Admin migrations found');
const sql = adminMigrationPaths.map((path) => readFileSync(path, 'utf8')).join('\n\n');

const browserTables = [
  'businesses',
  'business_shops',
  'business_employees',
  'employee_shop_assignments',
  'admin_permissions',
  'admin_role_permissions',
  'admin_employee_permissions',
  'admin_sessions',
];

for (const table of browserTables) {
  const rls = new RegExp(
    `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
    'i',
  );
  const revoke = new RegExp(
    `revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
    'i',
  );
  if (!rls.test(sql)) throw new Error(`Admin table lacks deny-by-default RLS: ${table}`);
  if (!revoke.test(sql)) throw new Error(`Admin table exposes browser data privileges: ${table}`);
}

if (!/create\s+table\s+if\s+not\s+exists\s+private\.admin_pin_rate_limits/i.test(sql)) {
  throw new Error('PIN throttle state must remain in the private schema');
}
if (
  !/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)
) {
  throw new Error('Private Admin schema must be revoked from browser roles');
}

const trustedRpcs = [
  'resolve_admin_authorization_v1',
  'claim_tux_admin_pin_attempt',
  'clear_tux_admin_pin_attempts',
  'bootstrap_tux_admin_owner_v1',
];
for (const rpc of trustedRpcs) {
  const escaped = rpc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const revoke = new RegExp(
    `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]*?\\)\\s*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`,
    'i',
  );
  const grant = new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]*?\\)\\s*to\\s+service_role\\s*;`,
    'i',
  );
  if (!revoke.test(sql)) throw new Error(`Admin RPC is executable by browser roles: ${rpc}`);
  if (!grant.test(sql)) throw new Error(`Admin RPC is not explicitly service-role-only: ${rpc}`);
}

console.log(
  `Admin client/BFF/Vercel/RLS/RPC security invariants passed across ${adminMigrationPaths.length} canonical Admin migrations.`,
);

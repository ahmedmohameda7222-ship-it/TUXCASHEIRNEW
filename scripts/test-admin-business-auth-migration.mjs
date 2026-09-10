import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260910100000_admin_business_auth.sql';
const sql = fs.readFileSync(migrationPath, 'utf8');
const lower = sql.toLowerCase();

for (const required of [
  'create table if not exists public.businesses',
  'create table if not exists public.business_shops',
  'create table if not exists public.business_employees',
  'create table if not exists public.employee_shop_assignments',
  'create table if not exists public.admin_permissions',
  'create table if not exists public.admin_role_permissions',
  'create table if not exists public.admin_employee_permissions',
  'create table if not exists public.admin_sessions',
  'resolve_admin_authorization_v1',
  "'owner'",
  "'admin'",
  "'manager'",
  "'staff'",
  'reauthenticated_at',
]) {
  if (!lower.includes(required)) throw new Error(`missing ${required}`);
}

for (const table of [
  'businesses',
  'business_shops',
  'business_employees',
  'employee_shop_assignments',
  'admin_permissions',
  'admin_role_permissions',
  'admin_employee_permissions',
  'admin_sessions',
]) {
  if (!lower.includes(`alter table public.${table} enable row level security`)) {
    throw new Error(`missing RLS for ${table}`);
  }
}

for (const role of ['public', 'anon', 'authenticated']) {
  if (!new RegExp(`revoke\\s+all\\s+on\\s+(?:table\\s+)?public\\.[a-z0-9_]+[\\s\\S]*?from\\s+${role}`).test(lower)) {
    throw new Error(`missing direct-browser revoke for ${role}`);
  }
}

for (const functionName of [
  'resolve_admin_authorization_v1',
  'claim_tux_admin_pin_attempt',
  'clear_tux_admin_pin_attempts',
]) {
  if (!lower.includes(`function public.${functionName}`)) {
    throw new Error(`missing ${functionName}`);
  }
  if (!new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?from\\s+public`).test(lower)) {
    throw new Error(`${functionName} must revoke PUBLIC execution`);
  }
  if (!new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${functionName}[\\s\\S]*?to\\s+service_role`).test(lower)) {
    throw new Error(`${functionName} must be service-role only`);
  }
}

if (!lower.includes('private.admin_pin_rate_limits')) {
  throw new Error('missing private HMAC-keyed Admin PIN rate-limit store');
}
if (!lower.includes("rate_key ~ '^[0-9a-f]{64}$'")) {
  throw new Error('Admin PIN rate key must be a 64-hex server-derived digest');
}
if (!lower.includes('p_max_attempts integer default 8')) {
  throw new Error('Admin PIN limiter must default to eight attempts');
}
if (!lower.includes('p_window_seconds integer default 900')) {
  throw new Error('Admin PIN limiter must default to a 15-minute window');
}

if (lower.includes("operations_device'::text check")) {
  throw new Error('Admin schema must not replace Operations device role semantics');
}
if (lower.includes('create table public.shops') || lower.includes('create table if not exists public.shops')) {
  throw new Error('Admin schema must map the canonical shops table, not recreate it');
}
if (lower.includes('create table public.workers') || lower.includes('create table if not exists public.workers')) {
  throw new Error('Admin schema must not recreate canonical Operations workers');
}

console.log('Admin business/auth migration invariants passed.');

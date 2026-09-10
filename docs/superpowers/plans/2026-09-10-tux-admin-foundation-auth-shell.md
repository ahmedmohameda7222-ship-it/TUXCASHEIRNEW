# TUX Admin Foundation, Auth, and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Admin application, business-level identity model, secure PIN-only sessions, server-enforced RBAC/shop scope, and the adaptive mobile-first shell used by every later Admin module.

**Architecture:** Create a React/Vite workspace app at `apps/admin` using the same frontend ecosystem as Menu, but with a same-origin BFF under `apps/admin/api`. The BFF owns an HttpOnly opaque session cookie and uses server-only Supabase credentials; reusable types live in `packages/admin-contracts`. A forward-only migration introduces business/employee/Admin-session/permission data without breaking `OPERATIONS_DEVICE` or existing worker records.

**Tech Stack:** React 19.2.8, Vite 8.2.0, TypeScript 6.0.3, Wouter, TanStack React Query, Zod, Tailwind CSS, Radix UI, Supabase JS, PostgreSQL, Vitest, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- PIN-only login: no email, username, user code, OTP, or Operations-device enrollment in the normal Admin flow.
- Exact duplicate active PINs are rejected server-side.
- PIN values never persist in plaintext; session cookies are HttpOnly, Secure in production, SameSite=Lax, and store an opaque random token whose database representation is a SHA-256 digest.
- `OWNER | ADMIN | MANAGER | STAFF` are human Admin roles; existing `OPERATIONS_DEVICE` semantics remain intact.
- Every protected server read/write requires a resolved Admin principal and explicit shop/permission authorization.
- All Admin-owned Supabase tables and RPCs are deny-by-default to direct browser roles. Enable RLS on every new Admin table, revoke direct `anon`/`authenticated` access, revoke PUBLIC function execution where applicable, and grant trusted Admin RPC execution only to the server/service-role boundary.
- UI language is English; timezone is `Africa/Cairo`; currency defaults to EGP.
- Phone shell uses Home, Orders, Catalog, Inventory, More; permissions hide irrelevant destinations but never replace server authorization.

---

### Task 1: Create `@tux/admin-contracts`

**Files:**
- Create: `packages/admin-contracts/package.json`
- Create: `packages/admin-contracts/tsconfig.json`
- Create: `packages/admin-contracts/src/index.ts`
- Create: `packages/admin-contracts/src/auth.ts`
- Create: `packages/admin-contracts/src/commands.ts`
- Test: `packages/admin-contracts/src/auth.test.ts`

**Interfaces:**
- Produces: `AdminRole`, `AdminPermission`, `AdminSessionPrincipal`, `ShopScope`, `CommandEnvelope<T>`, `CommandResult<T>`, `AdminLoginRequest`, `AdminSessionResponse`.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest';
import { ADMIN_ROLES, isAdminRole } from './auth';

describe('Admin auth contracts', () => {
  it('accepts only human Admin roles', () => {
    expect(ADMIN_ROLES).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']);
    expect(isAdminRole('OWNER')).toBe(true);
    expect(isAdminRole('OPERATIONS_DEVICE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npx vitest run packages/admin-contracts/src/auth.test.ts
```

Expected: fail because `./auth` does not exist.

- [ ] **Step 3: Implement the contracts**

```ts
// packages/admin-contracts/src/auth.ts
export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export const isAdminRole = (value: string): value is AdminRole =>
  (ADMIN_ROLES as readonly string[]).includes(value);

export type AdminPermission = string;
export type AdminSessionPrincipal = {
  employeeId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  shopIds: string[];
};
export type ShopScope = { kind: 'shop'; shopId: string } | { kind: 'all-shops' };
export type AdminLoginRequest = { pin: string };
export type AdminSessionResponse = { principal: AdminSessionPrincipal; csrfToken: string };
```

```ts
// packages/admin-contracts/src/commands.ts
export type CommandEnvelope<T> = {
  commandId: string;
  expectedVersion?: number;
  shopId?: string;
  payload: T;
};
export type CommandResult<T> =
  | { ok: true; value: T; version?: number }
  | { ok: false; code: string; message: string; currentVersion?: number };
```

- [ ] **Step 4: Run contract tests/typecheck and verify GREEN**

```bash
npx vitest run packages/admin-contracts/src/auth.test.ts
npx tsc --noEmit -p packages/admin-contracts/tsconfig.json
```

Expected: both exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts
git commit -m "feat(admin): add shared Admin contracts"
```

### Task 2: Add business identity, Admin auth, permission, and session schema

**Files:**
- Create: `supabase/migrations/20260910100000_admin_business_auth.sql`
- Create: `scripts/test-admin-business-auth-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `businesses`, `business_shops`, `business_employees`, `employee_shop_assignments`, `admin_permissions`, `admin_role_permissions`, `admin_employee_permissions`, `admin_sessions`.
- Produces RPC: `resolve_admin_authorization_v1(p_employee_id uuid, p_shop_id uuid, p_permission text)`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
// scripts/test-admin-business-auth-migration.mjs
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910100000_admin_business_auth.sql', 'utf8');
const lower = sql.toLowerCase();
for (const required of [
  'create table if not exists public.businesses',
  'create table if not exists public.business_employees',
  'create table if not exists public.admin_sessions',
  'resolve_admin_authorization_v1',
  "'OWNER'",
  "'ADMIN'",
  "'MANAGER'",
  "'STAFF'",
]) {
  if (!lower.includes(required.toLowerCase())) throw new Error(`missing ${required}`);
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
for (const role of ['anon', 'authenticated']) {
  if (!lower.includes(`revoke all on` ) || !lower.includes(`from ${role}`)) {
    throw new Error(`missing direct-browser revoke for ${role}`);
  }
}
if (!lower.includes('revoke execute on function public.resolve_admin_authorization_v1')) {
  throw new Error('authorization RPC must revoke direct execution');
}
if (!lower.includes('grant execute on function public.resolve_admin_authorization_v1') || !lower.includes('to service_role')) {
  throw new Error('authorization RPC must be service-role only');
}
if (sql.includes("OPERATIONS_DEVICE'::text check")) throw new Error('must not replace device role semantics');
```

- [ ] **Step 2: Run the migration test and verify RED**

```bash
node scripts/test-admin-business-auth-migration.mjs
```

Expected: fail with ENOENT for the migration.

- [ ] **Step 3: Implement the schema with tenant-safe constraints**

```sql
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Africa/Cairo',
  currency_code text not null default 'EGP',
  created_at timestamptz not null default now()
);

create table if not exists public.business_shops (
  business_id uuid not null references public.businesses(id),
  shop_id uuid not null references public.shops(id),
  primary key (business_id, shop_id),
  unique (shop_id)
);

create table if not exists public.business_employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  display_name text not null,
  role text not null check (role in ('OWNER','ADMIN','MANAGER','STAFF')),
  pin_lookup_hash text,
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists business_employees_active_pin_lookup_uq
  on public.business_employees(business_id, pin_lookup_hash)
  where active and pin_lookup_hash is not null;

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.business_employees(id),
  token_hash text not null unique,
  csrf_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
```

Also seed one `businesses` row and map the existing canonical TUX shop idempotently; do not recreate or rename the existing shop.

For every Admin-owned table introduced by this migration (including hardening tables added at this same insertion point), explicitly `ENABLE ROW LEVEL SECURITY` and expose no permissive browser policy. Revoke direct table privileges from `anon` and `authenticated`. Revoke EXECUTE on every Admin RPC from `PUBLIC`, `anon`, and `authenticated`, then grant only the exact trusted RPCs to `service_role`. `resolve_admin_authorization_v1`, login-rate-limit RPCs, owner-bootstrap RPCs, and any credential/session helper in this migration must be callable only through the trusted Admin server boundary. Add migration assertions that fail if any new Admin table or RPC is left browser-accessible.

- [ ] **Step 4: Add the migration test to `test:migrations` and verify**

```bash
node scripts/test-admin-business-auth-migration.mjs
npm run test:migrations
```

Expected: both exit `0`, direct browser roles cannot read/write Admin credential/session/control tables or execute Admin RPCs, and existing migration suites remain green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910100000_admin_business_auth.sql scripts/test-admin-business-auth-migration.mjs package.json
git commit -m "feat(admin): add business identity and auth schema"
```

### Task 3: Implement secure Admin PIN/session BFF

**Files:**
- Create: `apps/admin/server/env.ts`
- Create: `apps/admin/server/pin.ts`
- Create: `apps/admin/server/session.ts`
- Create: `apps/admin/server/authorization.ts`
- Create: `apps/admin/api/admin/login.ts`
- Create: `apps/admin/api/admin/session.ts`
- Create: `apps/admin/api/admin/logout.ts`
- Test: `apps/admin/server/pin.test.ts`
- Test: `apps/admin/server/session.test.ts`

**Interfaces:**
- Produces: `hashPin(pin)`, `verifyPin(pin, encodedHash)`, `pinLookupHash(pin, secret)`, `createAdminSession(employeeId)`, `requireAdminPrincipal(request)`, `requirePermission(principal, permission, shopId?)`.
- HTTP: `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`.

- [ ] **Step 1: Write failing PIN/session tests**

```ts
import { describe, expect, it } from 'vitest';
import { hashPin, pinLookupHash, verifyPin } from './pin';

describe('Admin PIN security', () => {
  it('verifies a salted PIN hash and exposes no plaintext', async () => {
    const encoded = await hashPin('482731');
    expect(encoded).not.toContain('482731');
    expect(await verifyPin('482731', encoded)).toBe(true);
    expect(await verifyPin('482732', encoded)).toBe(false);
  });
  it('creates deterministic server-secret lookup hashes', async () => {
    expect(await pinLookupHash('482731', 'test-secret')).toBe(
      await pinLookupHash('482731', 'test-secret'),
    );
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/pin.test.ts apps/admin/server/session.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 3: Implement cryptography and cookie session behavior**

```ts
export async function pinLookupHash(pin: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pin));
  return Buffer.from(sig).toString('hex');
}
```

Use PBKDF2-SHA256 with a random salt and at least 210,000 iterations for the verifier hash. Generate a 32-byte random session token, store only `sha256(token)` in `admin_sessions`, and set `tux_admin_session=<opaque>` as HttpOnly/SameSite=Lax/Path=/ with Secure enabled outside local development. Validate `Origin` on mutation requests and compare the in-memory CSRF token supplied in `x-tux-admin-csrf` against the session hash.

- [ ] **Step 4: Run unit tests and endpoint typecheck**

```bash
npx vitest run apps/admin/server/pin.test.ts apps/admin/server/session.test.ts
npx tsc --noEmit -p tsconfig.api.json
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server apps/admin/api
git commit -m "feat(admin): add PIN-only secure sessions"
```

### Task 4: Scaffold the Admin PWA workspace

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/vite.config.ts`
- Create: `apps/admin/index.html`
- Create: `apps/admin/.env.example`
- Create: `apps/admin/vercel.json`
- Create: `apps/admin/public/manifest.webmanifest`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/app/App.tsx`
- Create: `apps/admin/src/app/queryClient.ts`
- Create: `apps/admin/src/styles/index.css`
- Modify: `package.json`
- Test: `apps/admin/src/app/App.test.tsx`

**Interfaces:**
- Produces workspace `@tux/admin`, commands `dev:admin`, `build:admin`, `typecheck:admin`.

- [ ] **Step 1: Write a failing shell render test**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the Admin identity', () => {
  render(<App />);
  expect(screen.getByText('TUX Admin')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/app/App.test.tsx
```

Expected: fail because `apps/admin` is not scaffolded.

- [ ] **Step 3: Create the workspace and base app**

```json
{
  "name": "@tux/admin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

Use the Menu-compatible frontend dependencies already present in the monorepo: React, React DOM, Wouter, TanStack Query, Zod, Tailwind, Radix primitives, Lucide, Sonner, and `@tux/admin-contracts`.

- [ ] **Step 4: Verify app build/typecheck/test**

```bash
npm install
npm run build -w @tux/admin
npm run typecheck -w @tux/admin
npx vitest run apps/admin/src/app/App.test.tsx
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin package.json package-lock.json
git commit -m "feat(admin): scaffold mobile-first Admin PWA"
```

### Task 5: Build session bootstrap, permission-aware routing, and shop context

**Files:**
- Create: `apps/admin/src/auth/AdminSessionProvider.tsx`
- Create: `apps/admin/src/auth/LoginPage.tsx`
- Create: `apps/admin/src/auth/useAdminSession.ts`
- Create: `apps/admin/src/app/routes.tsx`
- Create: `apps/admin/src/shops/ShopScopeProvider.tsx`
- Create: `apps/admin/src/shops/ShopSwitcher.tsx`
- Create: `apps/admin/src/lib/adminApi.ts`
- Test: `apps/admin/src/auth/AdminSessionProvider.test.tsx`
- Test: `apps/admin/src/shops/ShopScopeProvider.test.tsx`

**Interfaces:**
- Consumes: `AdminSessionResponse` from `@tux/admin-contracts`.
- Produces: `useAdminSession()`, `useShopScope()`, `adminFetch<T>()`.

- [ ] **Step 1: Write failing route/session tests**

```tsx
it('redirects an unauthenticated user to the PIN screen', async () => {
  server.use(http.get('/api/admin/session', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));
  render(<AdminSessionProvider><TestRoutes /></AdminSessionProvider>);
  expect(await screen.findByText('Enter PIN')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/auth/AdminSessionProvider.test.tsx apps/admin/src/shops/ShopScopeProvider.test.tsx
```

Expected: fail because providers do not exist.

- [ ] **Step 3: Implement authenticated route and shop-scope behavior**

```ts
export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin' });
  if (!response.ok) throw new Error(`admin_request_${response.status}`);
  return response.json() as Promise<T>;
}
```

The provider must fetch `/api/admin/session` once, keep the returned CSRF token in memory, expose only authorized routes, default one-shop users directly into that shop, and allow `All Shops` only for OWNER aggregate views. Mutations while `All Shops` is selected must require a concrete shop before submission.

- [ ] **Step 4: Verify tests and build**

```bash
npx vitest run apps/admin/src/auth/AdminSessionProvider.test.tsx apps/admin/src/shops/ShopScopeProvider.test.tsx
npm run build -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/auth apps/admin/src/shops apps/admin/src/app/routes.tsx apps/admin/src/lib/adminApi.ts
git commit -m "feat(admin): add session routing and shop context"
```

### Task 6: Build the adaptive Apple-HIG-inspired shell

**Files:**
- Create: `apps/admin/src/components/shell/AdminShell.tsx`
- Create: `apps/admin/src/components/shell/MobileTabBar.tsx`
- Create: `apps/admin/src/components/shell/DesktopSidebar.tsx`
- Create: `apps/admin/src/components/shell/AdminTopBar.tsx`
- Create: `apps/admin/src/components/layout/PageScaffold.tsx`
- Create: `apps/admin/src/components/layout/ResponsiveDetail.tsx`
- Modify: `apps/admin/src/styles/index.css`
- Modify: `packages/ui/src/tokens.css`
- Test: `apps/admin/src/components/shell/AdminShell.test.tsx`
- E2E: `e2e/admin-shell.spec.ts`

**Interfaces:**
- Produces responsive navigation contract used by every module.

- [ ] **Step 1: Write failing responsive navigation tests**

```tsx
it('shows the five primary phone destinations', () => {
  render(<MobileTabBar permitted={['home','orders','catalog','inventory','more']} />);
  for (const label of ['Home', 'Orders', 'Catalog', 'Inventory', 'More']) {
    expect(screen.getByText(label)).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/components/shell/AdminShell.test.tsx
```

Expected: fail because shell components do not exist.

- [ ] **Step 3: Implement shell and shared Admin tokens**

```css
:root {
  --admin-touch-min: 44px;
  --admin-radius-card: 16px;
  --admin-content-max: 1440px;
  --admin-nav-blur: 20px;
}
```

Phone uses bottom tabs and full-screen details; tablet uses adaptive sidebar/split view; desktop uses sidebar plus inspector-capable content. Statuses must include text/icon and never depend on color alone. Critical actions must remain visible without hover.

- [ ] **Step 4: Verify unit/E2E/build**

```bash
npx vitest run apps/admin/src/components/shell/AdminShell.test.tsx
npx playwright test e2e/admin-shell.spec.ts
npm run build -w @tux/admin
```

Expected: exit `0` at 390px, 768px, and 1440px viewports.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components apps/admin/src/styles packages/ui/src/tokens.css e2e/admin-shell.spec.ts
git commit -m "feat(admin): add adaptive Admin application shell"
```

### Task 7: Foundation security and regression gate

**Files:**
- Create: `scripts/test-admin-security.mjs`
- Create: `e2e/admin-auth.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Produces CI commands `test:admin-security`, `test:e2e:admin`.

- [ ] **Step 1: Add failing architecture checks**

```js
import fs from 'node:fs';
const forbidden = ['SUPABASE_SERVICE_ROLE_KEY', 'META_ACCESS_TOKEN'];
const clientFiles = fs.readdirSync('apps/admin/src', { recursive: true });
for (const file of clientFiles.filter((x) => /\.(ts|tsx)$/.test(String(x)))) {
  const body = fs.readFileSync(`apps/admin/src/${file}`, 'utf8');
  for (const token of forbidden) if (body.includes(token)) throw new Error(`${token} leaked into client source`);
}
```

- [ ] **Step 2: Run the new checks and verify failure until scripts are wired**

```bash
npm run test:admin-security
```

Expected: fail because the script is not defined yet.

- [ ] **Step 3: Wire CI and Admin E2E login coverage**

Add scripts that run the architecture check and Playwright Admin suite; CI must build/typecheck Admin and run the Admin auth/shop-isolation tests on every PR. The security gate must also verify the Foundation migration keeps every Admin-owned table under RLS, revokes direct `anon`/`authenticated` data privileges, and exposes Admin RPC execution only to trusted server roles.

- [ ] **Step 4: Run the complete foundation gate**

```bash
npm run test:admin-security
npm run typecheck
npm test
npm run test:migrations
npm run build
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-admin-security.mjs e2e/admin-auth.spec.ts .github/workflows/ci.yml package.json
git commit -m "test(admin): enforce Admin auth and client security boundaries"
```
# TUX Admin Reliability and Production Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Admin against stale edits, duplicate submissions, connectivity loss, notification failures, and cross-app regressions, then complete mobile/PWA/Vercel production acceptance without breaking Menu or Operations.

**Architecture:** Use optimistic version checks for editable entities, idempotency keys for commands with side effects, server transactions for all multi-record business actions, and online-only mutations. Add application-level error normalization and observability, then make CI and production smoke acceptance enforce Admin/Menu/Operations consistency. Deploy Admin as a separate Vercel project from the same monorepo with browser-safe environment variables only.

**Tech Stack:** TypeScript, React, TanStack Query, PostgreSQL/Supabase, Vitest, Playwright, Vercel, existing monorepo CI.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- No offline mutation queue.
- A failed mutation must either commit nothing or return the one previously committed idempotent result.
- Stale edits never silently overwrite newer server state.
- Sensitive financial/inventory commands are not automatically retried by the client after ambiguous network failure.
- PWA app shell may be cached; business data shown offline must be explicitly marked stale/offline.
- Production acceptance requires real mobile-browser checks and real Menu/Admin/Operations smoke flows.
- Admin Vercel client environment never contains service-role, Meta, payment-provider, webhook, or comparable privileged secrets.

---

### Task 1: Standardize optimistic concurrency and idempotent command handling

**Files:**
- Create: `apps/admin/server/commands/commandExecutor.ts`
- Create: `apps/admin/server/commands/versionGuard.ts`
- Create: `supabase/migrations/20260911010000_admin_command_idempotency.sql`
- Test: `apps/admin/server/commands/commandExecutor.test.ts`
- Test: `scripts/test-admin-command-idempotency.mjs`

**Interfaces:**
- Produces `executeAdminCommand`, `assertExpectedVersion`, durable `admin_command_results` keyed by business/command id.

- [ ] **Step 1: Write failing duplicate/stale tests**

```ts
it('returns the original result for a repeated command id', async () => {
  const first = await executeAdminCommand(command, deps);
  const second = await executeAdminCommand(command, deps);
  expect(second).toEqual(first);
  expect(deps.performMutation).toHaveBeenCalledTimes(1);
});

it('rejects a stale expected version before mutation', async () => {
  await expect(assertExpectedVersion(48, 49)).rejects.toMatchObject({ code: 'stale_version' });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/commands/commandExecutor.test.ts
node scripts/test-admin-command-idempotency.mjs
```

Expected: fail before command infrastructure exists.

- [ ] **Step 3: Implement durable command results and version guard**

```ts
export function assertExpectedVersion(expected: number | undefined, current: number): void {
  if (expected !== undefined && expected !== current) {
    throw Object.assign(new Error('This record changed while you were editing it.'), {
      code: 'stale_version',
      currentVersion: current,
    });
  }
}
```

`executeAdminCommand` must check/store a canonical result inside the same transaction as the business mutation where possible. Commands whose outcome is uncertain to the browser must be queryable by command id rather than blindly retried.

- [ ] **Step 4: Verify command and migration tests**

```bash
npx vitest run apps/admin/server/commands/commandExecutor.test.ts
node scripts/test-admin-command-idempotency.mjs
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/commands supabase/migrations/20260911010000_admin_command_idempotency.sql scripts/test-admin-command-idempotency.mjs
git commit -m "feat(admin): harden concurrency and idempotency"
```

### Task 2: Implement offline/stale UI state and safe error recovery

**Files:**
- Create: `apps/admin/src/connectivity/ConnectivityProvider.tsx`
- Create: `apps/admin/src/connectivity/OfflineBanner.tsx`
- Create: `apps/admin/src/lib/adminErrors.ts`
- Create: `apps/admin/src/components/feedback/MutationError.tsx`
- Modify: `apps/admin/src/lib/adminApi.ts`
- Test: `apps/admin/src/connectivity/ConnectivityProvider.test.tsx`
- Test: `apps/admin/src/lib/adminErrors.test.ts`

**Interfaces:**
- Produces `useConnectivity()`, `AdminError`, online-only mutation guard and human-readable retry behavior.

- [ ] **Step 1: Write failing offline mutation test**

```tsx
it('disables business mutations when offline', () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  render(<ConnectivityProvider><TestMutationButton /></ConnectivityProvider>);
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByText(/offline/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/connectivity/ConnectivityProvider.test.tsx apps/admin/src/lib/adminErrors.test.ts
```

Expected: fail before modules exist.

- [ ] **Step 3: Implement connectivity and error normalization**

Map server codes such as `stale_version`, `approval_required`, `forbidden`, `insufficient_stock`, `already_processed`, and `offline` to plain-English messages and explicit next actions. Preserve unsaved form state after network failure; do not claim success until the server returns success or a previously committed idempotent result.

- [ ] **Step 4: Verify UI tests/build**

```bash
npx vitest run apps/admin/src/connectivity/ConnectivityProvider.test.tsx apps/admin/src/lib/adminErrors.test.ts
npm run build -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/connectivity apps/admin/src/lib apps/admin/src/components/feedback
git commit -m "feat(admin): add safe offline and error recovery UX"
```

### Task 3: Complete PWA shell caching and update behavior

**Files:**
- Create: `apps/admin/public/sw.js`
- Create: `apps/admin/src/pwa/registerServiceWorker.ts`
- Create: `apps/admin/src/pwa/UpdateAvailableBanner.tsx`
- Modify: `apps/admin/public/manifest.webmanifest`
- Modify: `apps/admin/src/main.tsx`
- Test: `e2e/admin-pwa.spec.ts`

**Interfaces:**
- Produces installable standalone PWA with shell/static-asset caching and no queued API mutations.

- [ ] **Step 1: Write failing Playwright PWA assertions**

```ts
test('manifest is installable and mutation APIs are not cached', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
  const sw = await (await request.get('/sw.js')).text();
  expect(sw).not.toContain("'/api/admin/'");
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx playwright test e2e/admin-pwa.spec.ts
```

Expected: fail before service worker exists.

- [ ] **Step 3: Implement shell-only service worker**

Cache versioned static app-shell assets and safe GET navigation fallbacks. Network-only handling applies to `/api/admin/*`; no Background Sync registration and no local queue for finance/inventory/catalog/staff commands. Display an update banner when a new worker is waiting.

- [ ] **Step 4: Verify PWA E2E**

```bash
npx playwright test e2e/admin-pwa.spec.ts
npm run build -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/public apps/admin/src/pwa apps/admin/src/main.tsx e2e/admin-pwa.spec.ts
git commit -m "feat(admin): complete safe installable PWA"
```

### Task 4: Add Admin observability and actionable failure alerts

**Files:**
- Create: `apps/admin/server/observability/adminLogger.ts`
- Create: `apps/admin/server/observability/healthChecks.ts`
- Create: `apps/admin/api/admin/health.ts`
- Create: `apps/admin/src/alerts/AlertsPage.tsx`
- Create: `apps/admin/src/alerts/AlertDetailPage.tsx`
- Test: `apps/admin/server/observability/healthChecks.test.ts`

**Interfaces:**
- Produces structured server logs and Admin health/alert records for API failures, scheduled publish failures, notification failures, database command failures, and configuration publish failures.

- [ ] **Step 1: Write failing redaction test**

```ts
it('redacts PIN and privileged-secret shaped fields', () => {
  expect(sanitizeLogContext({ pin: '482731', serviceRoleKey: 'secret', commandId: 'c1' })).toEqual({
    pin: '[REDACTED]', serviceRoleKey: '[REDACTED]', commandId: 'c1',
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/observability/healthChecks.test.ts
```

Expected: fail before observability helpers exist.

- [ ] **Step 3: Implement structured health checks and alert projection**

Logs must carry request/command id, actor id when authenticated, shop id where applicable, domain, result code, and latency without storing plaintext PINs, session tokens, provider secrets, customer message contents, or media secrets. Admin alerts remain Critical / Needs Attention / Info and link to an actionable record/screen.

- [ ] **Step 4: Verify tests**

```bash
npx vitest run apps/admin/server/observability/healthChecks.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/observability apps/admin/api/admin/health.ts apps/admin/src/alerts
git commit -m "feat(admin): add observability and actionable alerts"
```

### Task 5: Add cross-app regression and Admin production CI gates

**Files:**
- Create: `scripts/test-admin-architecture.mjs`
- Create: `scripts/test-admin-cross-app-publish.mjs`
- Create: `e2e/admin-cross-app.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Produces `test:admin-architecture`, `test:admin-cross-app`, `test:e2e:admin` scripts and CI jobs.

- [ ] **Step 1: Write failing cross-app assertions**

```js
// scripts/test-admin-cross-app-publish.mjs
// Seed a product at published version N, publish a changed draft through the Admin command path,
// then assert the Menu public-catalog query and Operations configuration query both expose version N+1 and the same price/modifier/combo identifiers.
throw new Error('cross-app publish harness not implemented');
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:admin-cross-app
```

Expected: fail until the harness/script is wired and implemented.

- [ ] **Step 3: Implement CI matrix and regression harness**

CI must run Admin typecheck/build/unit/E2E, migration tests, catalog architecture, WhatsApp architecture/security, existing Menu/Operations tests, and cross-app publish consistency. Architecture check rejects privileged env names in `apps/admin/src` and unrestricted direct browser Supabase mutation clients.

- [ ] **Step 4: Run full CI-equivalent commands locally**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:migrations
npm run test:catalog-architecture
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run test:admin-architecture
npm run test:admin-cross-app
npm run test:e2e
npm run build
```

Expected: every command exits `0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-admin-architecture.mjs scripts/test-admin-cross-app-publish.mjs e2e/admin-cross-app.spec.ts .github/workflows/ci.yml package.json
git commit -m "test(admin): add production regression gates"
```

### Task 6: Add deployment/runbook and execute production acceptance

**Files:**
- Create: `apps/admin/DEPLOYMENT.md`
- Create: `docs/ADMIN_PRODUCTION_ACCEPTANCE.md`
- Modify: `README.md`

**Interfaces:**
- Produces exact separate-Vercel-project deployment settings and a checked production acceptance record.

- [ ] **Step 1: Write the deployment contract before deploying**

```text
Project: TUX Admin
Repository: ahmedmohameda7222-ship-it/TUXCASHEIRNEW
Production branch: main
Build command: npm run build -w @tux/admin
Output directory: apps/admin/dist
Node: >=20.19.0 <27
Browser env: only non-secret public configuration
Server env: Supabase URL plus server-only privileged values required by Admin BFF
```

- [ ] **Step 2: Verify production build artifact**

```bash
npm ci
npm run build -w @tux/admin
npm run typecheck -w @tux/admin
```

Expected: exit `0`, `apps/admin/dist` exists.

- [ ] **Step 3: Execute real mobile/browser acceptance**

Run the acceptance document on real iPhone/Safari and Android/Chrome where available. Verify PIN login, shop switch, dashboard, product edit/publish, Sold Out, inventory adjustment, receiving, PO, order/refund approval, expense, Bank & Cash, End Day, staff edit, reports, WhatsApp not-configured/connected surfaces, PWA install, and notification behavior. Record pass/fail evidence in `docs/ADMIN_PRODUCTION_ACCEPTANCE.md`.

- [ ] **Step 4: Execute real production cross-app smoke flow**

Publish one safe catalog change through production Admin, verify production Menu reads the new published version, verify production Operations reads the same configuration version, execute one safe inventory/expense/staff/approval flow, and confirm no cross-shop data leak. Any failed check blocks acceptance and is corrected before repeating the affected check.

- [ ] **Step 5: Run final reviewer gate and commit acceptance documentation**

```bash
git add apps/admin/DEPLOYMENT.md docs/ADMIN_PRODUCTION_ACCEPTANCE.md README.md
git commit -m "docs(admin): record deployment and production acceptance"
```

Expected final state: Vercel Admin deployment READY, production migrations verified, Menu/Operations unchanged except intended published configuration, mobile acceptance passed, and no unresolved serious review finding.

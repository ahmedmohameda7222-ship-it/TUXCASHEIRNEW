# TUX Admin Implementation Plan Hardening Addendum

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining execution ambiguities discovered during plan self-review without adding new product scope: first-OWNER bootstrap, one-person PIN coherence across Admin/Operations identities, practical replenishment metadata, reason-coded discount/comp/cancellation reporting, and the exact separate-Vercel deployment contract.

**Architecture:** This is a cross-plan addendum, not a new business subsystem. Each task is executed at the insertion point named below and modifies the already planned domain boundary rather than creating a parallel implementation.

**Tech Stack:** Existing Admin/Supabase/Operations stack, Node.js scripts, PostgreSQL RPCs, Vitest, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- No default or hard-coded production PIN is committed to the repository.
- No plaintext PIN is stored or logged.
- Existing worker/order/history records are preserved; migrations are additive/backwards-compatible first.
- Existing Operations device authentication remains separate from Admin session authentication.
- Replenishment suggestions never place supplier orders automatically.
- Existing historical discounts/cancellations with no reason metadata remain `Legacy / Unclassified`; the system never fabricates a reason.
- The Admin browser talks to the same-origin Admin BFF and never receives service-role/provider secrets.

---

### Task 1: Add a safe one-time first-OWNER bootstrap

**Insertion point:** Execute immediately after Foundation Plan Task 3 (Admin PIN/session BFF) and before relying on browser PIN login.

**Files:**
- Modify planned migration: `supabase/migrations/20260910100000_admin_business_auth.sql`
- Create: `apps/admin/server/bootstrapOwner.ts`
- Create: `scripts/bootstrap-admin-owner.mjs`
- Test: `apps/admin/server/bootstrapOwner.test.ts`
- Test: `scripts/test-admin-owner-bootstrap.mjs`

**Interfaces:**
- Produces service-role-only RPC `bootstrap_tux_admin_owner_v1(...)`.
- Produces operator command `node scripts/bootstrap-admin-owner.mjs --name "<display name>"` that reads the PIN without echoing it, computes the same Admin PIN lookup/verifier formats used by the application, and submits only hashes to the bootstrap RPC.

- [ ] **Step 1: Write failing bootstrap tests**

```ts
it('allows bootstrap only while the business has no active OWNER', async () => {
  await bootstrapOwner({ displayName: 'Owner', pin: '482731' }, deps);
  await expect(bootstrapOwner({ displayName: 'Other', pin: '593842' }, deps))
    .rejects.toMatchObject({ code: 'owner_already_exists' });
});
```

The script-level test must also reject any implementation that contains a literal production PIN or prints the entered PIN.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/bootstrapOwner.test.ts
node scripts/test-admin-owner-bootstrap.mjs
```

Expected: fail before bootstrap implementation exists.

- [ ] **Step 3: Implement one-time bootstrap authority**

The RPC must lock the business row/advisory business identity, verify that no active `OWNER` exists, insert exactly one OWNER with all-shop authority, and return the created employee id. It is executable only by `service_role`; `anon` and `authenticated` receive no grant. The CLI must use the canonical business/TUX shop mapping, never create a second shop, and never write plaintext credentials to files, stdout, audit context, or command arguments.

If an OWNER already exists, the script exits non-zero with a clear message and does not mutate anything. Future OWNER creation is performed through authenticated Staff/Permissions management and normal approval rules, not through bootstrap.

- [ ] **Step 4: Verify bootstrap/security integration**

```bash
npx vitest run apps/admin/server/bootstrapOwner.test.ts apps/admin/server/pin.test.ts apps/admin/server/session.test.ts
node scripts/test-admin-owner-bootstrap.mjs
node scripts/test-admin-business-auth-migration.mjs
npm run test:migrations
```

Expected: test-mode bootstrap succeeds once, duplicate bootstrap is rejected, no plaintext PIN appears, migration suite exits `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910100000_admin_business_auth.sql apps/admin/server/bootstrapOwner.ts apps/admin/server/bootstrapOwner.test.ts scripts/bootstrap-admin-owner.mjs scripts/test-admin-owner-bootstrap.mjs
git commit -m "feat(admin): add one-time owner bootstrap"
```

### Task 2: Make one employee PIN coherent across Admin and linked Operations workers

**Insertion point:** Execute with Workforce Plan Tasks 1–2 before the Staff E2E gate.

**Files:**
- Modify planned migration: `supabase/migrations/20260910200000_admin_workforce.sql`
- Modify: `apps/admin/server/staff/staffService.ts`
- Modify: `packages/admin-contracts/src/staff.ts`
- Create: `apps/admin/server/staff/employeePin.ts`
- Test: `apps/admin/server/staff/employeePin.test.ts`
- Test: `scripts/test-admin-worker-pin-compatibility.mjs`

**Interfaces:**
- Produces `setEmployeePin(employeeId, newPin, principal)`.
- Uses one entered numeric PIN for the person, while preserving the two authentication boundaries: Admin authenticates the business employee; Operations authenticates a shop-scoped linked worker on an enrolled Operations device.
- Produces `assertPinAvailableForLinkedWorkers(employeeId, candidatePin)` that rejects a candidate matching another active worker in any target shop.

- [ ] **Step 1: Write failing coherence/collision/compatibility tests**

```ts
it('updates the employee and every linked active worker atomically', async () => {
  await setEmployeePin('employee-1', '482731', owner, deps);
  expect(deps.employeePinWrites).toBe(1);
  expect(deps.workerPinWrites).toBe(2);
  expect(deps.committedTransactions).toBe(1);
});

it('rejects a PIN already used by another active worker in an assigned shop', async () => {
  deps.seedWorker({ workerId: 'other-worker', shopId: 'shop-1', pin: '482731' });
  await expect(setEmployeePin('employee-1', '482731', owner, deps))
    .rejects.toMatchObject({ code: 'pin_already_in_use' });
  expect(deps.committedTransactions).toBe(0);
});
```

Add compatibility coverage proving the PBKDF2 encoded hash emitted by the Admin helper satisfies the existing worker-auth format/iteration requirements.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/staff/employeePin.test.ts
node scripts/test-admin-worker-pin-compatibility.mjs
```

Expected: fail before the canonical employee-PIN command exists.

- [ ] **Step 3: Implement transactional PIN propagation and collision checking**

Use the same `pbkdf2-sha256$iterations$salt$digest` verifier format already accepted by `supabase/functions/worker-auth/index.ts`. Before writing, the trusted server checks the Admin HMAC lookup hash for an exact active business-employee duplicate and verifies the candidate PIN against every other active worker hash in each assigned/target shop, excluding worker rows already linked to this employee. Any match returns `pin_already_in_use` before mutation.

A successful PIN reset computes one new verifier hash plus the Admin-only HMAC lookup hash and updates `business_employees.pin_hash`, `business_employees.pin_lookup_hash`, and all linked active `workers.pin_hash` in one transaction. Because PBKDF2 hashes are salted, collision checking against legacy worker rows must call the verifier; equality of stored hashes is not a valid duplicate test.

Do not try to reverse/decrypt existing worker hashes during backfill. When an existing worker is first linked to a business employee and no Admin credential can be derived, mark Admin credential setup as required. An authorized PIN reset establishes the canonical PIN and propagates it to all linked worker identities. If legacy active workers in a shop already share an exact PIN, surface a remediation conflict rather than silently selecting one. Suspending the employee continues to revoke Admin access and linked operational access as defined by the Workforce plan without deleting history.

- [ ] **Step 4: Verify Admin/Operations authentication regression**

```bash
npx vitest run apps/admin/server/staff/employeePin.test.ts apps/admin/server/pin.test.ts
node scripts/test-admin-worker-pin-compatibility.mjs
node scripts/test-worker-pin-rate-limit.mjs
npm test
```

Expected: Admin and linked Operations worker authentication accept the newly set PIN, the old PIN stops authenticating after reset, duplicate worker-shop PINs are rejected, and device-bound Operations authentication remains required.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910200000_admin_workforce.sql packages/admin-contracts/src/staff.ts apps/admin/server/staff scripts/test-admin-worker-pin-compatibility.mjs
git commit -m "feat(admin): keep employee PINs coherent with Operations"
```

### Task 3: Bind par/reorder logic to practical supplier replenishment settings

**Insertion point:** Execute inside Inventory/Purchasing Plan Tasks 4–5.

**Files:**
- Modify planned migration: `supabase/migrations/20260910140000_admin_inventory_intelligence.sql`
- Modify planned migration: `supabase/migrations/20260910150000_admin_purchasing.sql`
- Modify: `apps/admin/server/inventory/intelligence.ts`
- Modify: `apps/admin/server/purchasing/purchasingService.ts`
- Modify: `apps/admin/src/inventory/ReorderSuggestionsPage.tsx`
- Modify: `apps/admin/src/purchasing/PurchaseOrderPage.tsx`
- Test: `apps/admin/server/inventory/intelligence.test.ts`

**Interfaces:**
- Produces shop/item `inventory_replenishment_settings` with `par_level_base`, `reorder_point_base`, preferred supplier, preferred purchase unit, `lead_time_days`, minimum order quantity, and order multiple.
- Produces an editable expected-delivery date/reference on purchase orders.
- Final canonical signature supersedes the simpler Inventory-plan example: `suggestOrderQuantity({ available, par, incoming, minimumOrder, orderMultiple }): number`; `minimumOrder` and `orderMultiple` are optional/nullable configuration so the simple par behavior remains valid when absent.

- [ ] **Step 1: Write failing replenishment tests**

```ts
it('rounds a reorder suggestion to the supplier order multiple', () => {
  expect(suggestOrderQuantity({
    available: 6000,
    par: 15000,
    incoming: 2000,
    minimumOrder: 4000,
    orderMultiple: 2000,
  })).toBe(8000);
});
```

Also cover zero suggestion when available plus incoming already meets target, and preferred-supplier/lead-time display.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/inventory/intelligence.test.ts
```

Expected: current simple par formula does not yet support supplier constraints.

- [ ] **Step 3: Implement deterministic supplier-aware suggestions**

Calculate the raw shortage from available/incoming/target state; `available` already represents on-hand minus reservations, so reservations must not be subtracted twice. Then apply configured minimum order and order-multiple rounding. Preferred supplier and lead time inform the suggestion and expected-arrival UI; they do not create or transmit a purchase order automatically. When no supplier rule exists, retain the simple `max(0, par - available - incoming)` behavior.

Overdue-PO alerts use the PO expected-delivery date, not a guessed provider state. Supplier invoice/payment/attachment handling remains in the purchasing scope-completion task.

- [ ] **Step 4: Verify inventory/purchasing integration**

```bash
npx vitest run apps/admin/server/inventory/intelligence.test.ts apps/admin/server/purchasing/purchasingService.test.ts
npm run test:migrations
```

Expected: suggestion quantities, supplier metadata, and incoming PO quantities reconcile without changing stock before receiving.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910140000_admin_inventory_intelligence.sql supabase/migrations/20260910150000_admin_purchasing.sql apps/admin/server/inventory apps/admin/server/purchasing apps/admin/src/inventory/ReorderSuggestionsPage.tsx apps/admin/src/purchasing/PurchaseOrderPage.tsx
git commit -m "feat(admin): add supplier-aware replenishment settings"
```

### Task 4: Capture and report manual discount, comp, and cancellation reasons without rewriting order history

**Insertion point:** Capture changes alongside Orders Plan Tasks 1–2; reporting changes alongside Finance/Reports Plan Tasks 4–5.

**Files:**
- Modify planned migration: `supabase/migrations/20260910160000_admin_order_controls.sql`
- Modify: `packages/application/src/orders.ts`
- Modify: `packages/application/src/orders.test.ts`
- Modify Operations checkout UI files discovered during execution where manual discount is currently entered
- Modify: `packages/admin-contracts/src/orders.ts`
- Modify: `apps/admin/server/orders/orderService.ts`
- Modify: `apps/admin/server/reports/reportService.ts`
- Modify: `apps/admin/src/reports/ReportView.tsx`
- Test: `apps/admin/server/reports/reportService.test.ts`
- E2E: `e2e/admin-orders.spec.ts`
- E2E: `e2e/admin-reports.spec.ts`

**Interfaces:**
- A manual order reduction is classified as `DISCOUNT` or `COMP` and references a central `discount/comp` reason code.
- Canonical `CANCELLED` remains the order status; the reporting label `Void / Cancelled` is a presentation/reporting concept, not a new persisted order status.
- Cancellation reason references the central order-cancellation reason family.
- Produces `AdjustmentReport` and `reportService.adjustments(filters, principal): Promise<AdjustmentReport>`; this becomes part of the Reports service contract.

- [ ] **Step 1: Write failing reason-capture/report tests**

```ts
it('separates promotion discounts, manual discounts, comps, and cancellations by reason', async () => {
  const report = await service.adjustments(filters, owner);
  expect(report.summary).toMatchObject({
    manualDiscountMinor: expect.any(Number),
    compMinor: expect.any(Number),
    promotionDiscountMinor: expect.any(Number),
    cancelledOrderCount: expect.any(Number),
  });
});
```

Add placement coverage requiring a valid reason when a manual discount/comp is applied, while preserving zero-discount orders unchanged.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run packages/application/src/orders.test.ts apps/admin/server/reports/reportService.test.ts
npx playwright test e2e/admin-orders.spec.ts e2e/admin-reports.spec.ts
```

Expected: current order draft/history lacks enough reason classification for the new report assertions.

- [ ] **Step 3: Implement immutable reason snapshots/events**

Capture manual discount/comp classification and reason as immutable order-time metadata/event data through the canonical Operations placement path. Cancellation continues to append a status/audit event with its reason. Promotion effects remain sourced from promotion snapshots and are not misclassified as manual discounts.

Do not mutate old orders to invent reasons. Historical rows lacking the new metadata are shown as `Legacy / Unclassified`. Reports provide totals and drill-down by shop, employee, reason, adjustment kind, date, and order source. Admin remains read/control oriented; it does not become a second POS discount-entry surface.

- [ ] **Step 4: Verify order/report reconciliation**

```bash
npx vitest run packages/application/src/orders.test.ts apps/admin/server/orders/orderService.test.ts apps/admin/server/reports/reportService.test.ts
npx playwright test e2e/admin-orders.spec.ts e2e/admin-reports.spec.ts
npm test
npm run test:migrations
```

Expected: adjustment report totals reconcile to underlying immutable orders/events and existing statuses remain `ACTIVE | DONE | CANCELLED | RETURNED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910160000_admin_order_controls.sql packages/application/src/orders.ts packages/application/src/orders.test.ts packages/admin-contracts/src/orders.ts apps/admin/server/orders apps/admin/server/reports apps/admin/src/reports e2e/admin-orders.spec.ts e2e/admin-reports.spec.ts
git commit -m "feat(admin): add reason-coded discount and cancellation reporting"
```

### Task 5: Lock the exact Admin Vercel monorepo deployment contract

**Insertion point:** Execute as the authoritative deployment detail for Reliability/Production Plan Task 6 before any Admin production deployment.

**Files:**
- Create/verify: `apps/admin/vercel.json`
- Create: `apps/admin/DEPLOYMENT.md`
- Modify: `package.json`
- Create: `scripts/test-admin-deployment-contract.mjs`
- Modify: `docs/ADMIN_PRODUCTION_ACCEPTANCE.md`

**Interfaces:**
- Separate Vercel project for Admin; same GitHub monorepo and same canonical Supabase/backend authority.

- [ ] **Step 1: Encode the deployment contract and failing invariant test**

The deployment guide must specify exactly:

```text
Vercel project: tux-admin (separate from Operations and Menu)
Repository: ahmedmohameda7222-ship-it/TUXCASHEIRNEW
Production branch: main
Root Directory: apps/admin
Framework: Vite
Install command: cd ../.. && npm ci
Build command: cd ../.. && npm run build:admin
Output Directory: dist
Node engine: repository engine >=20.19.0 <27
Include source files outside Root Directory: enabled, because the Admin workspace consumes root workspaces/shared packages
```

The SPA fallback must preserve generated `/api/*` Function routes before falling back to `index.html` for clean client routes. A blanket rewrite that captures `/api/admin/*` is prohibited.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-deployment-contract.mjs
```

Expected: fail until `apps/admin`, root scripts, deployment guide, and Vercel routing contract exist.

- [ ] **Step 3: Implement exact build/routing/environment contract**

Add root scripts `dev:admin`, `build:admin`, `typecheck:admin`, and `test:e2e:admin` during the Foundation plan. `apps/admin/vercel.json` must use filesystem/function precedence before SPA fallback so `/api/admin/*` remains serverless.

Admin browser environment should not need direct Supabase mutation credentials because it uses the same-origin BFF. Any optional browser-visible values must be explicitly public. Server-only Admin Vercel variables include the canonical Supabase URL/service credential and Admin PIN lookup secret under the names finalized by `apps/admin/server/env.ts`; push/provider/storage secrets, when configured, remain server-only. Never prefix privileged values with `VITE_`.

- [ ] **Step 4: Verify deployment artifact and route isolation**

```bash
npm ci
npm run build:admin
npm run typecheck:admin
node scripts/test-admin-deployment-contract.mjs
npx playwright test e2e/admin-pwa.spec.ts e2e/admin-auth.spec.ts
```

Expected: `apps/admin/dist` is created from the root workspace build, client routes fall back to the SPA, `/api/admin/*` continues to resolve to Functions, and no privileged variable is present in the browser bundle.

- [ ] **Step 5: Execute real Vercel/production acceptance only after the full reliability gate**

Create/link the separate `tux-admin` Vercel project with the contract above, configure server variables in that project, deploy `main`, then run the real mobile/cross-app acceptance from `docs/ADMIN_PRODUCTION_ACCEPTANCE.md`. A deployment being `READY` is not sufficient by itself; Menu, Operations, Admin, shop isolation, PIN login, publish consistency, and production smoke checks must all pass before acceptance is recorded.

- [ ] **Step 6: Commit deployment contract documentation/tests**

```bash
git add apps/admin/vercel.json apps/admin/DEPLOYMENT.md package.json scripts/test-admin-deployment-contract.mjs docs/ADMIN_PRODUCTION_ACCEPTANCE.md
git commit -m "docs(admin): lock monorepo Vercel deployment contract"
```

---

## Hardening Verification Matrix

Before calling implementation planning complete, verify these five points are explicitly represented in executable plans:

- [ ] A first OWNER can be created securely without a pre-existing Admin session and without a default plaintext PIN.
- [ ] One employee PIN reset can coherently update the Admin credential and every linked shop worker credential, reject collisions with other active workers, and preserve Operations device authentication.
- [ ] Reorder suggestions have concrete supplier/lead-time/minimum/order-multiple metadata and remain recommendations only.
- [ ] Manual discount, comp, promotion discount, and cancelled/void reporting have immutable source data and legacy-unclassified behavior.
- [ ] Admin has an exact separate-Vercel monorepo contract matching the existing root-workspace deployment pattern while preserving `/api/*` Functions.

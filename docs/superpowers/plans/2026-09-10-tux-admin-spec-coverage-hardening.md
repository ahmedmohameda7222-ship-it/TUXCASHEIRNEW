# TUX Admin Spec Coverage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the remaining already-approved specification requirements explicit and executable where the domain plans were too implicit: Admin login throttling and permission taxonomy, generic sensitive re-PIN, emergency negative-stock override, complete loyalty/promotion rules, expense receipts, detailed shop/payment/checkout lifecycle, domain alerts, archive/delete enforcement, and accessibility acceptance.

**Architecture:** This plan adds no new product capability beyond the approved design. Each task is inserted into the named existing domain plan and extends that domain's canonical service/schema rather than creating a competing source of truth. Shared cross-cutting policies are small server modules consumed by domain services.

**Tech Stack:** TypeScript, React, PostgreSQL/Supabase, Vitest, Playwright, `@axe-core/playwright`, existing Admin BFF and shared contracts.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- PIN login remains PIN-only; security controls stay invisible during normal successful use.
- Authorization is deny-by-default and server enforced.
- Every sensitive mutation continues to obey shop scope, audit, concurrency, and approval rules.
- No new inventory/customer/catalog/finance source of truth is introduced.
- No import functionality and no export functionality.
- Historical records are not rewritten to satisfy new reporting or lifecycle rules.

---

### Task 1: Finalize Admin permission taxonomy, PIN throttling, and generic sensitive re-PIN

**Insertion point:** Execute with Foundation/Auth Tasks 1–3 and before Approvals Task 2.

**Files:**
- Modify planned: `packages/admin-contracts/src/auth.ts`
- Modify planned: `supabase/migrations/20260910100000_admin_business_auth.sql`
- Create: `apps/admin/server/loginRateLimit.ts`
- Create: `apps/admin/server/reauth.ts`
- Create: `apps/admin/api/admin/reauth.ts`
- Modify planned: `apps/admin/api/admin/login.ts`
- Modify planned: `apps/admin/server/authorization.ts`
- Test: `apps/admin/server/loginRateLimit.test.ts`
- Test: `apps/admin/server/reauth.test.ts`
- Modify planned E2E: `e2e/admin-auth.spec.ts`

**Interfaces:**
- Produces `ADMIN_PERMISSIONS`, `AdminPermission`, `requirePermission(principal, permission, shopId?)`.
- Produces `claimAdminPinAttempt(clientKey)`, `clearAdminPinAttempts(clientKey)`, and HTTP `429` with `Retry-After` when throttled.
- Produces `reauthenticateAdminSession(principal, pin)` and `requireRecentReauth(session, maxAgeSeconds)`.

Canonical permission keys:

```ts
export const ADMIN_PERMISSIONS = [
  'orders.view', 'orders.manage', 'orders.cancel', 'orders.refund',
  'catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish',
  'inventory.view', 'inventory.adjust', 'inventory.stocktake', 'inventory.transfer', 'inventory.override_negative',
  'purchasing.view', 'purchasing.manage', 'purchasing.receive',
  'customers.view', 'customers.manage', 'customers.merge',
  'loyalty.manage', 'promotions.manage',
  'staff.view', 'staff.manage', 'staff.payments',
  'delivery.view', 'delivery.manage',
  'finance.view', 'finance.adjust', 'finance.reconcile', 'finance.manage_accounts',
  'reports.view', 'alerts.view',
  'shops.manage', 'devices.view', 'devices.manage',
  'settings.manage', 'whatsapp.view', 'whatsapp.manage',
  'audit.view', 'approvals.review',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
```

- [ ] **Step 1: Write failing permission/rate-limit/re-PIN tests**

```ts
it('rejects unknown permission keys at the contract boundary', () => {
  expect(isAdminPermission('catalog.publish')).toBe(true);
  expect(isAdminPermission('catalog.do_anything')).toBe(false);
});

it('returns throttled after the configured failed PIN budget', async () => {
  for (let i = 0; i < 8; i += 1) await limiter.claim('client-a');
  await expect(limiter.claim('client-a')).rejects.toMatchObject({ code: 'too_many_pin_attempts' });
});

it('requires a fresh PIN confirmation for a sensitive command', async () => {
  const session = await fixtureSession({ reauthenticatedAt: null });
  expect(() => requireRecentReauth(session, 300)).toThrow('reauthentication_required');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run packages/admin-contracts/src/auth.test.ts apps/admin/server/loginRateLimit.test.ts apps/admin/server/reauth.test.ts
```

Expected: fail before the permission union, limiter, and generic re-auth helper exist.

- [ ] **Step 3: Implement stable permissions and invisible auth hardening**

Seed `admin_permissions` from `ADMIN_PERMISSIONS` and seed role presets idempotently. OWNER resolves all permissions regardless of preset rows; ADMIN receives broad business-management defaults; MANAGER receives normal shop-management defaults; STAFF starts with a minimal preset and uses explicit overrides when more access is required. Per-user allow/deny overrides remain supported and server-authoritative.

Create a private/Admin-server-only failed-attempt store/RPC using an HMAC'd server-derived client key. Match the established Operations safety baseline: eight failed attempts in a rolling 15-minute window returns `429 too_many_pin_attempts` plus `Retry-After`; successful login clears the client bucket. Do not expose raw IP/user-agent values in the table or logs.

`POST /api/admin/reauth` verifies the current employee's PIN against the existing salted verifier and updates only `admin_sessions.reauthenticated_at`. Sensitive command handlers call `requireRecentReauth(session, 300)` before execution when policy requires acting-user re-authentication. Approval decisions still verify the approver's own PIN and may reuse the same verifier helper.

- [ ] **Step 4: Verify auth/security behavior**

```bash
npx vitest run packages/admin-contracts/src/auth.test.ts apps/admin/server/loginRateLimit.test.ts apps/admin/server/reauth.test.ts apps/admin/server/pin.test.ts apps/admin/server/session.test.ts
npx playwright test e2e/admin-auth.spec.ts
npm run test:admin-security
npm run test:migrations
```

Expected: valid PIN login remains one-screen/simple, unknown permissions are rejected, failed PIN brute force is throttled, recent re-PIN is required only for configured sensitive actions, and all commands remain server-authorized.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/auth.ts supabase/migrations/20260910100000_admin_business_auth.sql apps/admin/server/loginRateLimit.ts apps/admin/server/reauth.ts apps/admin/server/authorization.ts apps/admin/api/admin/login.ts apps/admin/api/admin/reauth.ts e2e/admin-auth.spec.ts
git commit -m "feat(admin): finalize permission and PIN security contracts"
```

### Task 2: Implement the OWNER-only emergency negative-stock override

**Insertion point:** Execute with Inventory Tasks 1–3.

**Files:**
- Modify planned: `supabase/migrations/20260910130000_admin_inventory_ledger.sql`
- Modify planned: `packages/admin-contracts/src/inventory.ts`
- Modify planned: `apps/admin/server/inventory/inventoryService.ts`
- Modify planned: `apps/admin/src/inventory/AdjustStockSheet.tsx`
- Test: `apps/admin/server/inventory/inventoryService.test.ts`
- Modify planned E2E: `e2e/admin-inventory.spec.ts`

**Interfaces:**
- Extends manual adjustment input with `emergencyNegativeOverride: boolean`.
- The override is permitted only when `principal.role === 'OWNER'`, permission `inventory.override_negative` is present, the session has recent re-PIN, and a structured adjustment reason plus note are supplied.

- [ ] **Step 1: Write failing owner-only override tests**

```ts
it('blocks a normal adjustment that would make Available negative', async () => {
  const result = await service.adjustStock({ ...input, quantityDeltaBase: -20, emergencyNegativeOverride: false }, owner);
  expect(result).toMatchObject({ ok: false, code: 'insufficient_stock' });
});

it('allows an audited recently-reauthenticated OWNER emergency adjustment', async () => {
  const result = await service.adjustStock(
    { ...input, quantityDeltaBase: -20, emergencyNegativeOverride: true, reasonCode: 'COUNT_CORRECTION', note: 'Verified physical count' },
    recentlyReauthedOwner,
  );
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/inventory/inventoryService.test.ts
```

Expected: fail because the explicit emergency policy is not implemented.

- [ ] **Step 3: Implement narrow emergency authority**

The inventory RPC/service calculates resulting `On Hand`, `Reserved`, and `Available` under row lock. Normal sales/reservations and ordinary adjustments continue to reject negative Available. Only the manual adjustment command can set the emergency flag. When used, the movement stores reason, note, actor, approval linkage when applicable, and an explicit `emergency_negative_override=true` audit attribute. Non-OWNER callers receive `forbidden` even if a custom permission row was accidentally granted.

- [ ] **Step 4: Verify inventory regression**

```bash
npx vitest run apps/admin/server/inventory/inventoryService.test.ts
npx playwright test e2e/admin-inventory.spec.ts
node scripts/test-admin-order-inventory-lifecycle.mjs
npm run test:migrations
```

Expected: ordinary negative stock remains impossible, OWNER override is explicit/audited/re-PIN protected, and order reservation behavior never silently uses the override.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910130000_admin_inventory_ledger.sql packages/admin-contracts/src/inventory.ts apps/admin/server/inventory/inventoryService.ts apps/admin/src/inventory/AdjustStockSheet.tsx e2e/admin-inventory.spec.ts
git commit -m "feat(admin): add audited emergency stock override"
```

### Task 3: Complete loyalty and promotion rule contracts

**Insertion point:** Execute inside Orders/Customers Task 4.

**Files:**
- Modify planned: `supabase/migrations/20260910180000_admin_loyalty_promotions.sql`
- Modify planned: `packages/admin-contracts/src/loyalty.ts`
- Modify planned: `apps/admin/server/customers/loyaltyService.ts`
- Modify planned: `apps/admin/src/customers/LoyaltyPanel.tsx`
- Modify planned: `apps/admin/src/promotions/PromotionEditor.tsx`
- Test: `apps/admin/server/customers/loyaltyService.test.ts`
- Modify planned E2E: `e2e/admin-customers-promotions.spec.ts`

**Interfaces:**
- Produces configurable loyalty rules: earn rate, redemption value/rate, minimum redemption threshold, optional point expiry, enabled state, and shop applicability when configured.
- Promotion kinds are `PERCENT | FIXED | FREE_ITEM`; rules include minimum order, business/shop scope, start/end, total usage limit, per-customer usage limit, `POS | ONLINE | BOTH`, product/category eligibility, and stacking policy.

- [ ] **Step 1: Write failing loyalty/promotion rule tests**

```ts
it('rejects redemption below the configured minimum', () => {
  expect(validateRedemption({ points: 80, minimumPoints: 100 })).toEqual({ ok: false, code: 'minimum_redemption_not_met' });
});

it('rejects an expired promotion and a customer over their usage limit', () => {
  expect(validatePromotion(expiredFixture, context).ok).toBe(false);
  expect(validatePromotion({ ...activeFixture, perCustomerLimit: 1 }, { ...context, priorCustomerUses: 1 }).ok).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/customers/loyaltyService.test.ts
```

Expected: the earlier promotion/ledger implementation lacks all approved configuration assertions.

- [ ] **Step 3: Implement immutable loyalty ledger plus explicit rule evaluation**

Point earn/redeem/manual adjustment remains ledger-based. Manual point adjustment requires reason and audit. Point expiry, when enabled, creates explicit expiry ledger events rather than editing prior earn rows. Promotion validation is deterministic from canonical order/customer/shop/time state, never makes payable total negative, and records the applied promotion/value snapshot on the order. Default stacking remains one order-level promotion unless the checkout configuration explicitly permits a supported combination.

- [ ] **Step 4: Verify CRM/promotion E2E**

```bash
npx vitest run apps/admin/server/customers/loyaltyService.test.ts
npx playwright test e2e/admin-customers-promotions.spec.ts
npm run test:migrations
```

Expected: earning, redemption minimum, optional expiry, manual adjustments, fixed/percent/free-item promotions, limits, channel/shop scope, and stacking rules pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910180000_admin_loyalty_promotions.sql packages/admin-contracts/src/loyalty.ts apps/admin/server/customers/loyaltyService.ts apps/admin/src/customers/LoyaltyPanel.tsx apps/admin/src/promotions/PromotionEditor.tsx e2e/admin-customers-promotions.spec.ts
git commit -m "feat(admin): complete loyalty and promotion rules"
```

### Task 4: Add private expense-receipt attachments

**Insertion point:** Execute with Finance Tasks 1–3 and Approved-Scope Completion Task 4.

**Files:**
- Modify planned: `supabase/migrations/20260910210000_admin_finance.sql`
- Create: `apps/admin/server/finance/expenseAttachments.ts`
- Create: `apps/admin/api/admin/expense-attachments.ts`
- Modify planned: `apps/admin/src/finance/AddExpenseSheet.tsx`
- Modify planned: `apps/admin/src/finance/ExpensesPage.tsx`
- Test: `apps/admin/server/finance/expenseAttachments.test.ts`
- Modify planned E2E: `e2e/admin-finance.spec.ts`

**Interfaces:**
- Produces private `expense_receipt_attachments` metadata linked to the canonical posted expense.
- Produces trusted signed upload preparation and short-lived authenticated view URL; storage credentials are never browser-visible.

- [ ] **Step 1: Write failing attachment-authorization tests**

```ts
it('refuses an expense receipt outside the principal shop scope', async () => {
  const result = await service.prepareExpenseReceiptUpload({ expenseId: 'expense-shop-b' }, shopAOnlyManager);
  expect(result).toMatchObject({ ok: false, code: 'forbidden' });
});

it('returns only a short-lived view URL, never a storage secret', async () => {
  const result = await service.getExpenseReceipt('expense-1', owner);
  expect(JSON.stringify(result)).not.toMatch(/service_role|secret_key/i);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/finance/expenseAttachments.test.ts
```

Expected: fail before expense attachment service exists.

- [ ] **Step 3: Implement optional receipt flow**

Expense creation remains valid without a receipt. When present, the browser selects/captures the receipt, obtains a trusted upload instruction, uploads to private storage, then commits only the opaque storage key/metadata against the canonical expense. Replacing/removing an attachment changes attachment metadata and audit history only; it never rewrites the expense amount/date/account movement. Apply retention/access rules through authenticated Admin service calls.

- [ ] **Step 4: Verify finance/security tests**

```bash
npx vitest run apps/admin/server/finance/expenseAttachments.test.ts
npx playwright test e2e/admin-finance.spec.ts
npm run test:admin-security
npm run test:migrations
```

Expected: optional receipt capture/view works on phone and desktop, cross-shop access is rejected, and no storage secret reaches client source or responses.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910210000_admin_finance.sql apps/admin/server/finance/expenseAttachments.ts apps/admin/api/admin/expense-attachments.ts apps/admin/src/finance/AddExpenseSheet.tsx apps/admin/src/finance/ExpensesPage.tsx e2e/admin-finance.spec.ts
git commit -m "feat(admin): add private expense receipts"
```

### Task 5: Make Shop, Payment, Checkout, Receipt, and lifecycle settings explicit

**Insertion point:** Execute inside Catalog/Settings Task 5 and Approved-Scope Completion special-hours work.

**Files:**
- Modify planned: `supabase/migrations/20260910120000_admin_shop_settings.sql`
- Modify planned: `packages/admin-contracts/src/settings.ts`
- Modify planned: `apps/admin/server/settings/settingsService.ts`
- Modify planned: `apps/admin/src/settings/ShopsPage.tsx`
- Modify planned: `apps/admin/src/settings/PaymentsPage.tsx`
- Modify planned: `apps/admin/src/settings/CheckoutPage.tsx`
- Modify planned: `apps/admin/src/settings/ReceiptsPage.tsx`
- Modify planned: `apps/admin/src/settings/SpecialHoursPage.tsx`
- Test: `apps/admin/server/settings/settingsService.test.ts`
- Modify planned E2E: `e2e/admin-settings.spec.ts`

**Interfaces:**
- Shop lifecycle: `ACTIVE | SUSPENDED | ARCHIVED`; used shops cannot be hard-deleted.
- Payment configuration includes enabled state, `POS | ONLINE | BOTH`, display name/order, optional reference requirement, manual-confirmation rule, refund permission, and shop assignment.
- Checkout configuration includes minimum order, service charge, tax/VAT settings, delivery-fee behavior, discount stacking, and supported payment restrictions by shop/zone.
- Receipt settings include canonical shop identity, footer, order numbering/prefix rules, and printer-routing reference; changes apply to future transactions only.

- [ ] **Step 1: Write failing settings/lifecycle tests**

```ts
it('archives a used shop instead of deleting it', async () => {
  const result = await service.deleteOrArchiveShop('used-shop', owner);
  expect(result).toMatchObject({ ok: true, action: 'ARCHIVED' });
});

it('rejects an ONLINE checkout method configured for POS only', async () => {
  expect(resolveAllowedPaymentMethods(posOnlyFixture, { channel: 'ONLINE' })).toEqual([]);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/settings/settingsService.test.ts
```

Expected: fail until lifecycle/payment/checkout details are explicit in the service contract.

- [ ] **Step 3: Implement complete settings authority**

Shop actions cover create/edit, suspend/reactivate, archive, user assignment, copy selected settings/catalog configuration, and per-shop overrides. Copy is explicit/selective and never silently overwrites a newer target-shop version. Weekly opening/delivery hours plus special-date overrides use `Africa/Cairo`. Temporary close and online-order pause remain immediate operational settings.

Payment, checkout, order-type, receipt, reason-code, and special-hours changes pass through the same trusted settings service and audit layer. Historical orders/payments/receipts retain their stored snapshots. Provider secrets are referenced only by server-side integration identifiers and are never returned to the browser.

- [ ] **Step 4: Verify settings and cross-app consumers**

```bash
npx vitest run apps/admin/server/settings/settingsService.test.ts
npx playwright test e2e/admin-settings.spec.ts
npm run test:catalog-architecture
npm run test:migrations
```

Expected: Menu/Operations see only published/effective settings, payment/channel restrictions are server-authoritative, special hours use Cairo time, and shop lifecycle/history is preserved.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910120000_admin_shop_settings.sql packages/admin-contracts/src/settings.ts apps/admin/server/settings/settingsService.ts apps/admin/src/settings e2e/admin-settings.spec.ts
git commit -m "feat(admin): complete shop payment and checkout settings"
```

### Task 6: Add deduplicated domain alert projection

**Insertion point:** Execute after the relevant domain services exist and before Reliability/Production alert acceptance.

**Files:**
- Create: `supabase/migrations/20260911005000_admin_alert_projection.sql`
- Create: `packages/admin-contracts/src/alerts.ts`
- Create: `apps/admin/server/alerts/alertService.ts`
- Create: `apps/admin/api/admin/alerts.ts`
- Modify planned: `apps/admin/src/alerts/AlertsPage.tsx`
- Modify planned: `apps/admin/src/alerts/AlertDetailPage.tsx`
- Test: `apps/admin/server/alerts/alertService.test.ts`
- E2E: `e2e/admin-alerts.spec.ts`

**Interfaces:**
- Alert priorities: `CRITICAL | NEEDS_ATTENTION | INFO`.
- Produces stable alert keys, `upsertActiveAlert(signal)`, `resolveAlert(key)`, `listAlerts(principal, filters)`.
- Signals cover low/out stock, significant stocktake variance, cash variance, failed online order, refund/approval attention, overdue PO, critical device offline, attendance exception, catalog/scheduled activation failure, promotion/config failure, and WhatsApp failures/status when configured.

- [ ] **Step 1: Write failing deduplication/authorization tests**

```ts
it('updates one active alert instead of spamming duplicates', async () => {
  await service.upsertActiveAlert(lowStockSignal);
  await service.upsertActiveAlert({ ...lowStockSignal, observedAt: later });
  expect(await store.countActiveByKey(lowStockSignal.key)).toBe(1);
});

it('does not return another shop alert to a shop-scoped manager', async () => {
  const alerts = await service.listAlerts(shopAManager, {});
  expect(alerts.some((alert) => alert.shopId === 'shop-b')).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/alerts/alertService.test.ts
```

Expected: fail before the common alert projection exists.

- [ ] **Step 3: Implement low-noise actionable alerts**

Each source domain emits/derives a deterministic alert key such as `LOW_STOCK:<shop>:<item>` or `DEVICE_OFFLINE:<shop>:<device>`. Repeated observations refresh one active alert. Resolution records `resolved_at` and does not delete history. Alert payload contains a safe route/entity reference and concise human text; detailed sensitive data is loaded only after authorization on the destination page. Critical alerts cannot be hidden by dashboard preferences.

- [ ] **Step 4: Verify alerts and notification integration**

```bash
npx vitest run apps/admin/server/alerts/alertService.test.ts apps/admin/server/notifications/pushService.test.ts
npx playwright test e2e/admin-alerts.spec.ts e2e/admin-notifications.spec.ts
npm run test:migrations
```

Expected: alert deduplication, priority, shop filtering, resolve/reopen behavior, actionable navigation, and privacy-safe push integration pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911005000_admin_alert_projection.sql packages/admin-contracts/src/alerts.ts apps/admin/server/alerts apps/admin/api/admin/alerts.ts apps/admin/src/alerts e2e/admin-alerts.spec.ts
git commit -m "feat(admin): add actionable domain alert projection"
```

### Task 7: Enforce the approved archive/delete policy across business entities

**Insertion point:** Execute after domain CRUD services exist and before production acceptance.

**Files:**
- Create: `apps/admin/server/archive/archivePolicy.ts`
- Create: `apps/admin/server/archive/archivePolicy.test.ts`
- Modify domain services: `apps/admin/server/catalog/catalogService.ts`, `apps/admin/server/staff/staffService.ts`, `apps/admin/server/purchasing/purchasingService.ts`, `apps/admin/server/settings/settingsService.ts`, `apps/admin/server/customers/loyaltyService.ts`
- Modify relevant domain detail/list UIs to expose `Archive` / `Restore` and only show `Delete Draft` when permitted.
- E2E: `e2e/admin-archive-policy.spec.ts`

**Interfaces:**
- Produces `decideDeleteAction({ entityType, entityId, lifecycleState, hasBusinessHistory }): 'HARD_DELETE_DRAFT' | 'ARCHIVE' | 'DENY'`.

- [ ] **Step 1: Write failing policy tests**

```ts
it('allows hard delete only for an unused draft', () => {
  expect(decideDeleteAction({ entityType: 'PRODUCT', entityId: 'p1', lifecycleState: 'DRAFT', hasBusinessHistory: false })).toBe('HARD_DELETE_DRAFT');
  expect(decideDeleteAction({ entityType: 'PRODUCT', entityId: 'p2', lifecycleState: 'ACTIVE', hasBusinessHistory: true })).toBe('ARCHIVE');
  expect(decideDeleteAction({ entityType: 'PUBLISHED_VERSION', entityId: 'v1', lifecycleState: 'PUBLISHED', hasBusinessHistory: true })).toBe('DENY');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/archive/archivePolicy.test.ts
```

Expected: fail before shared policy exists.

- [ ] **Step 3: Implement policy and domain adapters**

The service queries domain-specific usage/history before destructive action. Used products, employees, suppliers, shops, promotions, and comparable business entities archive/disable while retaining references. Published versions, transactions, audit records, stock movements, stocktakes, reconciliations, posted expenses, and staff payments are immutable and never hard-deleted through Admin. Restore creates/re-enables current state without erasing historical inactive periods.

- [ ] **Step 4: Verify destructive-action E2E**

```bash
npx vitest run apps/admin/server/archive/archivePolicy.test.ts
npx playwright test e2e/admin-archive-policy.spec.ts
npm run test:admin-security
```

Expected: no historical/used business record is physically deleted through normal Admin flows; unused drafts can be deleted only through an explicit confirmed action.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/archive apps/admin/server/catalog apps/admin/server/staff apps/admin/server/purchasing apps/admin/server/settings apps/admin/server/customers apps/admin/src e2e/admin-archive-policy.spec.ts
git commit -m "feat(admin): enforce archive and delete policy"
```

### Task 8: Add explicit accessibility acceptance for primary Admin flows

**Insertion point:** Execute with Reliability/Production CI before real-device production acceptance.

**Files:**
- Create: `e2e/admin-accessibility.spec.ts`
- Modify: `apps/admin/package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Modify planned: `docs/ADMIN_PRODUCTION_ACCEPTANCE.md`

**Interfaces:**
- Adds `@axe-core/playwright` as a development dependency for Admin E2E accessibility checks.
- CI covers automated serious/critical accessibility findings plus explicit keyboard/focus/touch checks on primary workflows.

- [ ] **Step 1: Write failing accessibility smoke tests**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('PIN login has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
});

test('primary mobile actions meet the 44px touch target contract', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const box = await page.getByRole('button', { name: /sign in/i }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx playwright test e2e/admin-accessibility.spec.ts
```

Expected: fail before the dependency/test and completed Admin screens exist.

- [ ] **Step 3: Cover primary authenticated flows and manual acceptance points**

Extend the file to scan Home, Orders, Catalog, Inventory, Staff, Finance, Settings, Approvals, and one modal/sheet at phone and desktop viewports. Add keyboard assertions for tab order, visible focus, Enter/Space activation, Escape dismissal where appropriate, and focus return after dialogs. Status meaning must never depend on color alone. The production acceptance document includes a screen-reader label/heading/landmark spot check on iOS/Android accessibility tooling where available.

- [ ] **Step 4: Run accessibility and shell gates**

```bash
npx playwright test e2e/admin-accessibility.spec.ts e2e/admin-shell.spec.ts e2e/admin-ux-completion.spec.ts
npm run build:admin
```

Expected: no serious/critical automated violations in primary flows, keyboard/focus assertions pass, touch targets meet the 44px contract, and Admin still builds.

- [ ] **Step 5: Commit**

```bash
git add e2e/admin-accessibility.spec.ts apps/admin/package.json package-lock.json .github/workflows/ci.yml docs/ADMIN_PRODUCTION_ACCEPTANCE.md
git commit -m "test(admin): enforce accessibility acceptance"
```

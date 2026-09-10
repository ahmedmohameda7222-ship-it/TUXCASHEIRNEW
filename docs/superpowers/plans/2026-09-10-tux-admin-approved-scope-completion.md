# TUX Admin Approved Scope Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close approved product requirements that cut across multiple domain plans so no accepted Admin capability remains only implicit before production hardening.

**Architecture:** Build these as thin, domain-owned UI/service additions on top of the already established Admin contracts and canonical data. This plan does not introduce new business subsystems; it completes approved cross-cutting UX and management surfaces before the final reliability/production plan.

**Tech Stack:** React 19.2.8, TypeScript 6.0.3, TanStack React Query, Tailwind/Radix, Supabase/PostgreSQL, Web Push/PWA APIs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- No new source of truth: each screen reads/writes the canonical domain service from the earlier plans.
- Mobile-first behavior and role/shop authorization remain mandatory.
- Critical alerts cannot be hidden; noncritical dashboard widgets may be reordered/resized/hidden/reset.
- Product images use private/trusted upload preparation and canonical catalog image keys; browser never receives storage-service secrets.
- Web push carries only the minimum information the authenticated role may receive and never exposes privileged secrets.

---

### Task 1: Build role-adaptive Dashboard and All-Shops overview

**Files:**
- Create: `apps/admin/src/dashboard/DashboardPage.tsx`
- Create: `apps/admin/src/dashboard/DashboardGrid.tsx`
- Create: `apps/admin/src/dashboard/DashboardWidget.tsx`
- Create: `apps/admin/src/dashboard/AllShopsOverview.tsx`
- Create: `apps/admin/server/reports/dashboardService.ts`
- Create: `apps/admin/api/admin/dashboard.ts`
- Test: `apps/admin/server/reports/dashboardService.test.ts`
- Test: `apps/admin/src/dashboard/DashboardPage.test.tsx`
- E2E: `e2e/admin-dashboard.spec.ts`

**Interfaces:**
- Produces `DashboardSnapshot` tailored by principal role and `ShopScope`.

- [ ] **Step 1: Write failing role-content tests**

```ts
it('does not return finance widgets to a staff principal without finance.view', async () => {
  const snapshot = await service.getDashboard(staffWithoutFinance, { kind: 'shop', shopId: 's1' });
  expect(snapshot.widgets.map((w) => w.kind)).not.toContain('estimated-profit');
});
```

```tsx
it('shows all-shops comparison only when the resolved scope is all-shops', () => {
  render(<DashboardPage snapshot={{ ...fixture, scope: { kind: 'all-shops' } }} />);
  expect(screen.getByText('Shop Comparison')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/reports/dashboardService.test.ts apps/admin/src/dashboard/DashboardPage.test.tsx
```

Expected: fail before Dashboard implementation.

- [ ] **Step 3: Implement role/shop-aware dashboard aggregation**

OWNER/ADMIN widgets include net sales, orders, estimated operating profit, AOV, low stock, cash difference, failed online orders, pending approvals, sales trend, top products, POS/ONLINE mix, and shop comparison. MANAGER emphasizes current sales/orders, active issues, low stock, staff on shift, delivery, cash reconciliation, and assigned approvals. STAFF receives only explicitly permitted widgets.

- [ ] **Step 4: Verify unit/E2E**

```bash
npx vitest run apps/admin/server/reports/dashboardService.test.ts apps/admin/src/dashboard/DashboardPage.test.tsx
npx playwright test e2e/admin-dashboard.spec.ts
```

Expected: exit `0` across phone/tablet/desktop cases.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/dashboard apps/admin/server/reports/dashboardService.ts apps/admin/api/admin/dashboard.ts e2e/admin-dashboard.spec.ts
git commit -m "feat(admin): add role-adaptive dashboard"
```

### Task 2: Add controlled dashboard customization

**Files:**
- Create: `supabase/migrations/20260911003000_admin_dashboard_preferences.sql`
- Create: `apps/admin/server/reports/dashboardPreferences.ts`
- Create: `apps/admin/src/dashboard/CustomizeDashboardSheet.tsx`
- Test: `apps/admin/server/reports/dashboardPreferences.test.ts`

**Interfaces:**
- Produces per-employee preferences for widget order, visibility, and supported size; critical widgets remain server-forced visible.

- [ ] **Step 1: Write failing critical-widget rule test**

```ts
it('refuses to hide a critical alert widget', () => {
  const result = applyDashboardPreferences(defaultWidgets, { hidden: ['critical-alerts'] });
  expect(result.find((w) => w.id === 'critical-alerts')?.hidden).toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/reports/dashboardPreferences.test.ts
```

Expected: fail before preference module exists.

- [ ] **Step 3: Implement reorder/hide/resize/reset behavior**

Persist only user presentation preferences; do not persist business metric values. Validate widget ids and size values server-side and ignore any attempt to hide a critical widget.

- [ ] **Step 4: Verify tests/migrations**

```bash
npx vitest run apps/admin/server/reports/dashboardPreferences.test.ts
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911003000_admin_dashboard_preferences.sql apps/admin/server/reports/dashboardPreferences.ts apps/admin/src/dashboard/CustomizeDashboardSheet.tsx
git commit -m "feat(admin): add dashboard customization"
```

### Task 3: Complete catalog image, bulk-action, archive, and stock-availability workflows

**Files:**
- Create: `apps/admin/server/catalog/imageService.ts`
- Create: `apps/admin/api/admin/catalog-images.ts`
- Create: `apps/admin/src/catalog/ProductImageEditor.tsx`
- Create: `apps/admin/src/catalog/BulkCatalogActions.tsx`
- Create: `apps/admin/src/catalog/ArchiveProductDialog.tsx`
- Create: `apps/admin/server/catalog/availability.ts`
- Test: `apps/admin/server/catalog/imageService.test.ts`
- Test: `apps/admin/server/catalog/availability.test.ts`
- E2E: `e2e/admin-catalog-completion.spec.ts`

**Interfaces:**
- Produces signed/trusted product-image upload preparation, image commit/cleanup, bulk price/availability/category/shop/publish actions, archive/restore, and human-readable availability reasons.

- [ ] **Step 1: Write failing availability/image tests**

```ts
it('keeps manual sold-out active after stock returns', () => {
  expect(resolveAvailability({ stockAvailable: true, manualSoldOut: true, shopVisible: true })).toEqual({
    available: false,
    reason: 'Manually marked Sold Out',
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/catalog/imageService.test.ts apps/admin/server/catalog/availability.test.ts
```

Expected: fail before completion modules exist.

- [ ] **Step 3: Implement catalog completion flows**

Product image flow supports camera/photo/file selection in the browser, crop/preview, client-side resize/compression, trusted signed upload, and final image-key attachment through the catalog command. Bulk actions operate on explicit selected product ids and show a preview before draft/publish. Used products archive/restore; hard delete is limited to unused drafts. Availability resolution distinguishes stock shortage, manual Sold Out, shop visibility, and scheduled rules.

- [ ] **Step 4: Verify completion E2E and catalog regression**

```bash
npx vitest run apps/admin/server/catalog/imageService.test.ts apps/admin/server/catalog/availability.test.ts
npx playwright test e2e/admin-catalog-completion.spec.ts
npm run test:catalog-architecture
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/catalog apps/admin/api/admin/catalog-images.ts apps/admin/src/catalog e2e/admin-catalog-completion.spec.ts
git commit -m "feat(admin): complete catalog management workflows"
```

### Task 4: Complete purchasing documents/status and recurring expense management

**Files:**
- Create: `apps/admin/server/purchasing/attachments.ts`
- Create: `apps/admin/src/purchasing/SupplierBalancePanel.tsx`
- Create: `apps/admin/src/purchasing/PurchaseAttachmentPanel.tsx`
- Create: `apps/admin/src/finance/RecurringExpensesPage.tsx`
- Create: `apps/admin/server/finance/recurringExpenses.ts`
- Create: `apps/admin/api/cron/admin-recurring-expenses.ts`
- Test: `apps/admin/server/finance/recurringExpenses.test.ts`
- E2E: `e2e/admin-purchasing-finance-completion.spec.ts`

**Interfaces:**
- Produces supplier invoice/reference/attachment handling, PO payment status (`UNPAID | PARTIALLY_PAID | PAID`), supplier balance summary, and idempotent recurring expense occurrence creation.

- [ ] **Step 1: Write failing recurring-expense test**

```ts
it('creates one monthly expense occurrence for the same rule and due date', async () => {
  await runRecurringExpenseScheduler(now, deps);
  await runRecurringExpenseScheduler(now, deps);
  expect(deps.createExpense).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/finance/recurringExpenses.test.ts
```

Expected: fail before scheduler exists.

- [ ] **Step 3: Implement purchasing/payment metadata and recurring expense scheduler**

Purchase attachments use private/trusted storage references. Supplier balance is derived from recorded purchase totals, payments, returns, and adjustments rather than a manually editable number. Recurring expenses generate due occurrences using Cairo business dates and deterministic rule/date idempotency keys.

- [ ] **Step 4: Verify E2E/tests**

```bash
npx vitest run apps/admin/server/finance/recurringExpenses.test.ts
npx playwright test e2e/admin-purchasing-finance-completion.spec.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/purchasing apps/admin/src/purchasing apps/admin/src/finance apps/admin/server/finance/recurringExpenses.ts apps/admin/api/cron/admin-recurring-expenses.ts e2e/admin-purchasing-finance-completion.spec.ts
git commit -m "feat(admin): complete purchasing and recurring expenses"
```

### Task 5: Complete CRM detail, special hours, appearance, and reusable UX states

**Files:**
- Create: `apps/admin/src/customers/CustomerAddresses.tsx`
- Create: `apps/admin/src/customers/CustomerNotesTags.tsx`
- Create: `apps/admin/src/customers/CustomerOrderHistory.tsx`
- Create: `apps/admin/src/settings/SpecialHoursPage.tsx`
- Create: `apps/admin/src/appearance/AppearanceProvider.tsx`
- Create: `apps/admin/src/settings/AppearanceSettings.tsx`
- Create: `apps/admin/src/components/feedback/EmptyState.tsx`
- Create: `apps/admin/src/components/feedback/LoadingState.tsx`
- Test: `apps/admin/src/appearance/AppearanceProvider.test.tsx`
- E2E: `e2e/admin-ux-completion.spec.ts`

**Interfaces:**
- Produces customer multiple-address/notes/tags/order-history surfaces, per-shop special opening/delivery dates, `System | Light | Dark`, and consistent loading/empty-state components.

- [ ] **Step 1: Write failing appearance test**

```tsx
it('uses system appearance when preference is System', () => {
  render(<AppearanceProvider preference="system"><Probe /></AppearanceProvider>);
  expect(screen.getByTestId('appearance')).toHaveAttribute('data-mode', 'system');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/appearance/AppearanceProvider.test.tsx
```

Expected: fail before appearance provider exists.

- [ ] **Step 3: Implement the approved UX/details**

Customer detail exposes Profile, Orders, Addresses, Loyalty, Spending, Notes, Tags, Promotions Used, WhatsApp, and History according to permission. Special hours override weekly hours for the specified Cairo business date. Appearance preference persists per user/device without affecting business data. Loading screens never render blank content, and empty states explain the next available action.

- [ ] **Step 4: Verify E2E/accessibility smoke**

```bash
npx vitest run apps/admin/src/appearance/AppearanceProvider.test.tsx
npx playwright test e2e/admin-ux-completion.spec.ts
```

Expected: light/dark/system and phone/desktop flows pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/customers apps/admin/src/settings/SpecialHoursPage.tsx apps/admin/src/appearance apps/admin/src/components/feedback e2e/admin-ux-completion.spec.ts
git commit -m "feat(admin): complete CRM settings and appearance UX"
```

### Task 6: Add privacy-safe Admin web push notifications

**Files:**
- Create: `supabase/migrations/20260911004000_admin_push_subscriptions.sql`
- Create: `packages/admin-contracts/src/notifications.ts`
- Create: `apps/admin/server/notifications/pushService.ts`
- Create: `apps/admin/api/admin/push-subscriptions.ts`
- Create: `apps/admin/src/notifications/NotificationSettingsPage.tsx`
- Create: `apps/admin/src/notifications/registerPush.ts`
- Test: `apps/admin/server/notifications/pushService.test.ts`
- E2E: `e2e/admin-notifications.spec.ts`

**Interfaces:**
- Produces per-admin push subscriptions/preferences and server delivery for approved Admin alerts/owner summaries.

- [ ] **Step 1: Write failing privacy test**

```ts
it('does not place customer phone, payment detail, or message content in lock-screen payload', () => {
  const payload = buildPushPayload(fixtureSensitiveAlert);
  expect(JSON.stringify(payload)).not.toContain('01012345678');
  expect(JSON.stringify(payload)).not.toContain('cardNumber');
  expect(payload).toMatchObject({ title: expect.any(String), body: expect.any(String), targetPath: expect.any(String) });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/notifications/pushService.test.ts
```

Expected: fail before push service exists.

- [ ] **Step 3: Implement subscription and notification policy**

Support Critical WhatsApp outage, failed messages, unanswered conversations, template status, large approval, critical stock, cash discrepancy, failed online order, device offline, scheduled publish failure, and daily owner summary. Noncritical notification categories are configurable. Critical notifications required by a responsible role cannot be silently disabled by an ordinary user. Push payload contains generic summary plus an authenticated in-app target path; detailed data is fetched only after Admin opens the authenticated app.

- [ ] **Step 4: Verify notification E2E and security**

```bash
npx vitest run apps/admin/server/notifications/pushService.test.ts
npx playwright test e2e/admin-notifications.spec.ts
npm run test:admin-security
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911004000_admin_push_subscriptions.sql packages/admin-contracts/src/notifications.ts apps/admin/server/notifications apps/admin/api/admin/push-subscriptions.ts apps/admin/src/notifications e2e/admin-notifications.spec.ts
git commit -m "feat(admin): add privacy-safe Admin push notifications"
```

# TUX Admin Review Hardening Addendum 3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Every amendment below is mandatory at its insertion point and follows RED → GREEN TDD.

**Goal:** Close the four remaining implementation-risk findings from the exact-head Codex review without expanding approved product scope: guarantee production invocation of every scheduled Admin job, serialize supplier-payment allocation against mutable PO payable state, propagate receipt/order-number settings into canonical Operations numbering/printing, and make central reason codes authoritative in applicable Operations mutations.

**Authority:** This file is a reviewed execution amendment and is mandatory together with `2026-09-10-tux-admin-review-hardening.md` and `2026-09-10-tux-admin-review-hardening-2.md`. Where an older numbered plan or earlier hardening instruction omits or conflicts with these requirements, this later amendment supplies the required execution detail while the approved design specification remains authoritative.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- A scheduled server route is not a production execution path unless deployment configuration actually invokes it and the invocation is authenticated.
- Supplier payment/return concurrency cannot allocate more than the canonical payable balance of a PO.
- Receipt identity and order-number settings are business configuration, not Admin-only display state. Operations must consume them for future numbering/printing while historical receipt/order snapshots remain immutable.
- Central reason codes are canonical structured business data. Free-text notes may supplement a reason where allowed but cannot replace the required reason-code identity.

---

## Amendment 10: Add authenticated production triggers for every scheduled Admin job

**Insertion point:** Execute across Catalog/Settings Task 4, Approvals/Audit plus Review Hardening 2 Amendment 6, Finance/Reports Task 6, Approved-Scope Completion Task 4, and Reliability/Production deployment Task 6. Gate 10 cannot pass until this is verified.

**Files:**
- Modify planned: `apps/admin/vercel.json`
- Modify planned: `apps/admin/DEPLOYMENT.md`
- Modify planned: `scripts/test-admin-deployment-contract.mjs`
- Modify planned: `apps/admin/api/cron/admin-config-scheduler.ts`
- Modify planned: `apps/admin/api/cron/admin-approval-executor.ts`
- Modify planned: `apps/admin/api/cron/admin-recurring-expenses.ts`
- Modify planned: `apps/admin/api/cron/admin-owner-summary.ts`
- Add focused route/deployment tests as required.

**Required deployment contract:**

1. `apps/admin/vercel.json` explicitly schedules every production route under `apps/admin/api/cron/`. At minimum the final reviewed plan set contains these routes and none may rely on traffic or a manual request to run:
   - `/api/cron/admin-config-scheduler`
   - `/api/cron/admin-approval-executor`
   - `/api/cron/admin-recurring-expenses`
   - `/api/cron/admin-owner-summary`
2. Use explicit reviewed cadences in the deployment contract:
   - config scheduler: `* * * * *` so due scheduled activations are revisited every minute;
   - approval executor: `* * * * *` so READY/RETRYABLE/expired-lease jobs are revisited every minute;
   - recurring expenses: `7 * * * *` (hourly at minute 7); the job decides due occurrences from `Africa/Cairo` business dates and deterministic rule/date idempotency keys;
   - owner summary: `23 * * * *` (hourly at minute 23); the job emits a given Cairo business-day summary only when its reviewed close/readiness condition is satisfied and exactly once per intended recipient/day.
3. Every cron route authenticates the production scheduler using the deployment secret contract (`CRON_SECRET` or the reviewed Vercel-equivalent server secret). Missing/invalid `Authorization: Bearer ...` is rejected. Browser/Admin session credentials alone do not authorize cron execution.
4. Cron routes accept no caller-supplied business command payload. They derive due work from canonical server state, claim bounded work, and invoke the same idempotent trusted services used by manual/server paths.
5. The deployment-contract test enumerates `apps/admin/api/cron/*.ts` and fails if a scheduled route is missing from `apps/admin/vercel.json`, duplicated, has a different path/cadence from the reviewed schedule map, or lacks the shared scheduler-auth guard. Adding a future cron route therefore requires updating the explicit schedule map and deployment contract in the same change.
6. Job semantics remain timezone-safe: Vercel cron expressions are trigger cadence only. Catalog schedules, recurring expenses, and owner-summary business dates are evaluated from canonical absolute timestamps plus `Africa/Cairo` business-time rules inside the trusted job.
7. Production documentation lists the required scheduler secret and a smoke procedure that proves each route rejects unauthenticated requests and that an authenticated invocation can safely return a no-work result.

**RED tests:**

```js
it('lists every Admin cron route in the Vercel deployment contract', () => {
  expect(crons).toEqual(expect.arrayContaining([
    { path: '/api/cron/admin-config-scheduler', schedule: '* * * * *' },
    { path: '/api/cron/admin-approval-executor', schedule: '* * * * *' },
    { path: '/api/cron/admin-recurring-expenses', schedule: '7 * * * *' },
    { path: '/api/cron/admin-owner-summary', schedule: '23 * * * *' },
  ]));
});
```

Add route tests proving missing/invalid scheduler authorization returns 401/403 and does not execute business work.

**GREEN acceptance:** every planned scheduled Admin job has an explicit authenticated production trigger, schedule/path drift is caught statically, repeated invocations are idempotent, and due business work does not depend on user traffic.

---

## Amendment 11: Serialize supplier-payment allocations and purchase returns against PO payable state

**Insertion point:** Execute with Review Hardening 2 Amendment 9 before Approved-Scope Completion Gate 9 accepts supplier payment state/balance.

**Supersedes:** Any implementation where two independent `record_supplier_payment_v1` or purchase-return transactions can validate the same stale PO payable balance concurrently.

**Files:**
- Modify planned finance/purchasing migration that creates `record_supplier_payment_v1` and purchase-return posting RPCs.
- Modify planned: `apps/admin/server/purchasing/purchasingService.ts`
- Modify planned: `apps/admin/server/purchasing/purchasingService.test.ts`
- Modify planned migration/service reconciliation tests.
- Modify planned E2E: `e2e/admin-purchasing-finance-completion.spec.ts`

**Required concurrency contract:**

1. Before calculating or changing the payable balance of any purchase order, supplier-payment allocation and purchase-return posting acquire the same database serialization boundary for that PO. Preferred implementation: lock the canonical `purchase_orders` row with `SELECT ... FOR UPDATE` inside the trusted transaction. A reviewed serializable/CAS equivalent is acceptable only if conflicts are retried/rejected deterministically.
2. A supplier payment allocating across multiple POs locks all referenced PO rows in a deterministic order (for example ascending UUID text) before validating any allocation. This prevents deadlocks and eliminates partial stale validation.
3. Under the lock, recompute canonical payable from received/invoiced obligations, immutable returns/credits/approved adjustments, and committed supplier-payment allocations. Never trust an Admin/browser-calculated balance.
4. Each allocation must be positive and cannot exceed the recomputed remaining payable of its PO. The sum of allocations cannot exceed the payment amount. Unallocated supplier credit is allowed only if the reviewed supplier-credit model explicitly represents it; otherwise require full intended allocation according to the approved command contract.
5. Purchase return posting uses the same PO lock/CAS discipline because a return changes payable state. A payment racing a return therefore observes either pre-return or post-return state serially; both cannot consume the same payable capacity.
6. Command-idempotency uniqueness remains separate from this PO-level concurrency invariant. Two different command ids can race and must still be serialized correctly.
7. A concurrency loser returns a stable business conflict such as `po_payable_changed` / `allocation_exceeds_payable` with current payable data; it never silently over-allocates and never creates a finance movement for a rejected payment.

**RED tests:**

```ts
it('does not over-allocate one PO under concurrent distinct payment commands', async () => {
  await receive(po, 100_000);
  const [a, b] = await Promise.all([
    service.recordSupplierPayment(payment('cmd-a', po.id, 80_000), buyer),
    service.recordSupplierPayment(payment('cmd-b', po.id, 80_000), buyer),
  ]);
  expect([a, b].filter((x) => x.ok)).toHaveLength(1);
  expect(await store.allocatedMinor(po.id)).toBe(80_000);
  expect(await store.financeMovementCountForAcceptedSupplierPayments()).toBe(1);
});

it('serializes a purchase return racing a supplier payment', async () => {
  await receive(po, 100_000);
  await Promise.allSettled([
    service.recordSupplierPayment(payment('cmd-pay', po.id, 80_000), buyer),
    service.recordPurchaseReturn(returnCommand('cmd-return', po.id, 40_000), buyer),
  ]);
  expect(await store.allocatedMinor(po.id)).toBeLessThanOrEqual(await store.payableAfterReturnsMinor(po.id));
});
```

**GREEN acceptance:** concurrent payments, payment-vs-return, multi-PO allocation, retry/idempotency, and cross-scope tests prove supplier balances and PO payment status can never be derived from an over-allocated payable.

---

## Amendment 12: Propagate receipt identity and order-number settings into canonical Operations execution

**Insertion point:** Execute with Catalog/Settings Task 5 and Review Hardening Amendment 4 before Catalog/Config Gate 2 is complete.

**Supersedes:** Any interpretation where Admin can save receipt/order-number settings without changing future canonical Operations numbering and receipt output.

**Files:**
- Modify planned: `supabase/migrations/20260910120000_admin_shop_settings.sql`
- Modify planned: `packages/admin-contracts/src/settings.ts`
- Modify existing: `packages/domain/src/businessDay.ts`
- Modify existing order snapshot/domain contracts as required.
- Modify existing: `packages/application/src/configurationSync.ts`
- Modify existing: `packages/application/src/configurationSync.sqlite.test.ts`
- Modify existing Operations business-day/order creation persistence and tests discovered during implementation.
- Modify existing: `packages/printing/src/receipt.ts`
- Modify/add existing receipt tests.
- Modify Operations print integration tests/E2E.
- Modify planned: `e2e/admin-settings.spec.ts`

**Required configuration/snapshot contract:**

1. The published per-shop configuration bundle consumed by Operations includes the effective canonical shop receipt identity and numbering policy: shop display name, address/contact fields approved for receipts, optional footer, order-number prefix/format, sequence start/reset policy, and a configuration/version identity.
2. Operations persists the effective receipt/numbering configuration locally through the existing configuration-sync boundary. Admin browser state is never read directly by printing or order creation.
3. Preserve the existing numeric `displayOrderNo` contract for compatibility. If configurable sequence start/reset behavior is enabled, initialize/advance that numeric sequence through one canonical Operations allocation function without changing its numeric type or allowing duplicates. Settings that affect sequence initialization apply at a safe business-day boundary; a mid-day settings edit cannot rewind/reuse an already allocated number.
4. Add an immutable human-facing order-number/receipt snapshot (for example `displayOrderLabel` plus `receiptSnapshot`) to future orders. It records the effective prefix/format, shop identity/footer values, and configuration version used for that order. Existing historical orders remain untouched and render through an explicit legacy fallback.
5. `packages/printing/src/receipt.ts` consumes the immutable order/receipt snapshot. It must stop hard-coding `TUX` and the fixed footer when a configured future-order snapshot is present. Reprinting an old order uses the original snapshot even if Admin settings have since changed.
6. Receipt identity changes never alter order financial totals or canonical numeric identifiers. Contact/location authority remains the same canonical shop setting used by Menu/delivery/WhatsApp where applicable.
7. Configuration rollout is backward compatible: older Operations snapshots continue using current TUX/default behavior until they receive the new optional fields; new fields are additive.

**RED tests:**

```ts
it('uses published shop receipt settings for future orders and preserves old snapshots', async () => {
  const before = await placeOrder();
  await publishReceiptSettings({ shopName: 'TUX Maadi', footer: 'Thank you', prefix: 'MD-' });
  await operationsConfig.catchUp();
  const after = await placeOrder();
  expect(after.displayOrderLabel).toMatch(/^MD-/);
  expect(renderOrderReceiptHtml(after)).toContain('TUX Maadi');
  expect(renderOrderReceiptHtml(after)).toContain('Thank you');
  expect(renderOrderReceiptHtml(before)).toBe(renderBeforeSettingsChange);
});
```

Add sequence-boundary coverage proving a settings update cannot duplicate or rewind a number already allocated in the active business day.

**GREEN acceptance:** Admin receipt settings change future Operations receipt identity/number formatting through published configuration, old receipts reprint identically, numeric order sequencing remains collision-free, and existing Menu/Operations tests remain green.

---

## Amendment 13: Make central reason codes authoritative in every applicable Operations mutation

**Insertion point:** Execute with Catalog/Settings Task 5, Plan Hardening Task 4, Orders/Customers/Delivery controls, Inventory/Purchasing reasoned mutations, and Finance End-Day/cash variance flows before the affected gates can pass.

**Supersedes:** Free-text-only reason capture for an operation whose approved reason family is centrally configured.

**Files:**
- Modify planned: `supabase/migrations/20260910120000_admin_shop_settings.sql`
- Modify planned: `packages/admin-contracts/src/settings.ts`
- Add/modify shared domain reason-code contracts, e.g. `packages/domain/src/reasonCodes.ts`.
- Modify existing: `packages/application/src/configurationSync.ts`
- Modify existing: `packages/application/src/configurationSync.sqlite.test.ts`
- Modify existing: `packages/application/src/orders.ts`
- Modify existing: `packages/application/src/orders.test.ts`
- Modify existing Operations End Day/reconciliation inputs and tests.
- Modify existing/planned inventory waste/adjustment, refund/return, pay-in/pay-out mutation boundaries where the corresponding reason family applies.
- Modify planned Admin order/report services and E2E tests.

**Required reason-code contract:**

1. Published configuration sync includes active reason codes, grouped by stable family: cancellation, refund/return, discount/comp, waste, stock adjustment, cash variance, pay-in, and pay-out. Each code has a stable immutable id/key, current label, active state, scope, and configuration/version identity.
2. Applicable trusted mutation inputs use a structured reason reference, not a free-text reason as the canonical classifier. Persist an immutable event snapshot containing at least reason-code id/key, label at event time, family, and configuration version. An optional free-text note may be stored separately where the approved UX permits explanation.
3. Operations cancellation, manual discount/comp, non-zero cash variance/end-day reconciliation, waste, stock adjustment, refund/return, pay-in, and pay-out validate that the selected code is active, visible in the actor/shop scope, and belongs to the required family. A code from another family is rejected.
4. Offline Operations may use the last successfully published local reason-code snapshot under the existing offline policy and must record that snapshot/version with the event. On reconnect, the server may accept the historically valid snapshotted code according to the reviewed compatibility rule; it must not silently rewrite the event to a new label/code.
5. Admin-origin mutations use the same central reason-code authority. Admin does not introduce a second reason vocabulary.
6. Deactivating/renaming a reason affects future selections only. Historical events/reports retain the immutable code-plus-label snapshot. Pre-feature rows render as `Legacy / Unclassified`; no backfill invents a reason.
7. Reports group primarily by stable reason id/key/family while displaying the event-time label, preventing fragmented free-text categories.

**RED tests:**

```ts
it('rejects a cancellation reason from the cash-variance family', async () => {
  const result = await orders.cancel({ orderId: 'o1', reasonCodeId: 'cash-short' }, worker);
  expect(result).toMatchObject({ ok: false, code: 'invalid_reason_family' });
});

it('snapshots the configured reason label so later renames do not rewrite history', async () => {
  await orders.cancel({ orderId: 'o1', reasonCodeId: 'customer-request' }, worker);
  await renameReason('customer-request', 'Customer changed mind');
  expect((await reports.cancellations()).rows[0].reasonLabel).toBe('Customer request');
});
```

Add focused tests for cash variance plus each implemented reason family and configuration-sync SQLite coverage.

**GREEN acceptance:** every applicable Operations/Admin mutation uses the same structured reason authority, wrong-family/inactive codes are rejected, historical event labels remain immutable, and adjustment/cancellation/cash/inventory reports no longer fragment by arbitrary free text.

---

## Review Gate Added by This Addendum

Before the affected checkpoints merge:

1. Every `apps/admin/api/cron/*.ts` scheduled route must have one authenticated production trigger with an explicitly tested cadence.
2. Supplier-payment allocation and purchase-return concurrency must serialize against canonical PO payable state and prove no over-allocation under distinct command ids.
3. Receipt identity/order-number settings must flow through published Operations configuration into collision-free numbering and immutable receipt snapshots consumed by the printer.
4. Central reason codes must flow through Operations configuration and be enforced/snapshotted at every applicable mutation boundary; free text alone cannot become the canonical classifier.
5. Exact-head CI and a fresh Codex review must pass with no unresolved serious finding.

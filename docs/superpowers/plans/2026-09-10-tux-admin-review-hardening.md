# TUX Admin Review Hardening Addendum

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Every task below is mandatory at its stated insertion point and follows RED → GREEN TDD.

**Goal:** Resolve the remaining implementation-risk findings from Codex review without changing approved product scope: true second-person approval, preservation of Operations business-day authority, conflict-safe Admin order cancellation in the local-first Operations model, checkout-settings propagation into real order execution, and loyalty/promotion propagation into POS and ONLINE order placement.

**Authority:** This file is a reviewed execution amendment to the approved plan set. Where an older numbered plan contains a conflicting implementation instruction, this addendum supersedes that instruction while preserving the approved design specification and numbered plan order.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Admin remains a management/control plane; Operations remains authoritative for live business-day execution and active-order progression.
- High-risk approval rules that require a second person can never be satisfied by the requester approving their own request.
- Existing local-first Operations SQLite/outbox behavior is preserved, but stale local lifecycle transitions can never overwrite a newer canonical Admin/Operations lifecycle decision.
- Published checkout, payment, loyalty, and promotion rules are not Admin-only metadata; the canonical Menu and Operations order paths consume and enforce them.
- Historical order/payment snapshots remain immutable. New checkout/promotion/loyalty snapshot columns or JSON fields are additive and apply to future transactions only.
- Browser-supplied prices, discounts, fees, taxes, promotion eligibility, loyalty balances, or usage counts are never authoritative.

---

## Amendment 1: Require a distinct second-person approver

**Insertion point:** Execute inside `2026-09-10-tux-admin-approvals-audit.md` Tasks 1–3.

**Supersedes:** Any approval-plan wording that treats possession of `approvals.review` plus a valid PIN as sufficient when the configured rule is a second-person approval.

**Files:**
- Modify planned: `supabase/migrations/20260910125000_admin_approvals_audit.sql`
- Modify planned: `apps/admin/server/approvals/approvalService.ts`
- Modify planned: `apps/admin/server/approvals/approvalService.test.ts`
- Modify planned: `e2e/admin-approvals-audit.spec.ts`

**Required contract:**

- `decide_admin_approval_request_v1` must reject an approver whose employee id equals `requester_employee_id` with stable code `self_approval_forbidden` whenever the request requires second-person approval.
- Persist an invariant equivalent to `approver_employee_id IS NULL OR approver_employee_id <> requester_employee_id` for second-person requests; do not rely only on UI hiding.
- PIN re-entry authenticates the approver but never waives the distinct-person rule.
- OWNER is not exempt from the distinct-person requirement when the configured rule says second-person approval. If no eligible second approver exists, the request remains pending rather than silently self-approving.

**RED test:**

```ts
it('rejects requester self-approval even with a valid approver PIN', async () => {
  const result = await service.approve({ requestId: 'r1', pin: '482731' }, requesterOwner);
  expect(result).toMatchObject({ ok: false, code: 'self_approval_forbidden' });
  expect(store.createExecutionJob).not.toHaveBeenCalled();
});
```

**GREEN acceptance:** self-approval is rejected at the database/service boundary, a different authorized employee can approve, duplicate approval still executes at most once, and audit history records requester and approver separately.

---

## Amendment 2: Keep canonical business-day close authority in Operations

**Insertion point:** Execute inside `2026-09-10-tux-admin-finance-reports.md` Tasks 1 and 4.

**Supersedes:** The planned `close_business_day_finance_v1` contract and every instruction saying Admin locks an OPEN `business_days` row and closes the canonical business day.

**Files:**
- Modify planned: `supabase/migrations/20260910210000_admin_finance.sql`
- Modify planned: `packages/admin-contracts/src/endDay.ts`
- Modify planned: `apps/admin/server/finance/endDayService.ts`
- Modify planned: `apps/admin/server/finance/endDayService.test.ts`
- Modify existing: `packages/application/src/endDay.ts`
- Modify existing: `packages/application/src/endDay.test.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.test.ts`
- Modify planned E2E: `e2e/admin-end-day.spec.ts`

**Required contract:**

- Rename the Admin finance primitive to `finalize_business_day_finance_v1` (or an equivalently reviewed name) and make it **read/derive from an already CLOSED canonical `business_days` row**.
- The RPC/service must not update `business_days.status`, `ended_at`, worker-session state, or any Operations closing record.
- Operations continues to close the day through its existing `packages/application/src/endDay.ts` flow and sync the `BUSINESS_DAY_CLOSED` event through the existing remote materializer.
- Finance finalization may occur synchronously after the canonical close becomes visible or by a retryable server job, but it is idempotent and unique on `(shop_id, business_day_id)`.
- Calling finance finalization while the business day is OPEN returns `operations_business_day_still_open` and performs no finance snapshot mutation.
- A second finalization after a snapshot exists returns/replays the same terminal result and never creates a second Z snapshot.

**RED tests:**

```ts
it('cannot close an Operations-owned open business day from Admin', async () => {
  const result = await service.finalizeDay(openDayInput, owner);
  expect(result).toMatchObject({ ok: false, code: 'operations_business_day_still_open' });
  expect(canonicalBusinessDay.status).toBe('OPEN');
});

it('finalizes exactly once after Operations closes the day', async () => {
  await operationsEndDay.closeDay(...);
  const first = await service.finalizeDay(closedDayInput, owner);
  const second = await service.finalizeDay(closedDayInput, owner);
  expect(first.ok).toBe(true);
  expect(second).toEqual(first);
  expect(store.snapshotCount(closedDayInput.businessDayId)).toBe(1);
});
```

**GREEN acceptance:** the Operations close flow remains the only writer of canonical business-day closure; Admin X is non-closing; Admin Z/history is derived from finalized Operations state and is immutable.

---

## Amendment 3: Make Admin cancellation safe against local-first Operations races

**Insertion point:** Execute before accepting `2026-09-10-tux-admin-orders-customers-delivery.md` Task 1 and before any Admin cancellation E2E is considered green.

**Supersedes:** Any plan instruction that performs a direct remote `ACTIVE → CANCELLED` update without reconciling the Operations SQLite/outbox lifecycle and its `operational_revision` fence.

**Files:**
- Modify planned: `supabase/migrations/20260910160000_admin_order_controls.sql`
- Modify planned: `apps/admin/server/orders/orderService.ts`
- Modify planned: `apps/admin/server/orders/orderService.test.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.test.ts`
- Modify existing: `packages/sync/src/remoteReceipt.ts`
- Modify existing: `packages/sync/src/remoteReceipt.test.ts`
- Modify existing: `packages/sync/src/httpTransport.ts`
- Modify existing: `packages/sync/src/httpTransport.test.ts`
- Modify existing: `packages/application/src/ordersBoard.ts`
- Modify existing: `packages/application/src/ordersBoard.test.ts`
- Modify planned E2E: `e2e/admin-orders.spec.ts`

**Required contract:**

1. All canonical order lifecycle transitions, including Admin cancellation and Operations DONE/CANCEL/UNDO/RETURN sync, use a compare-and-swap transition boundary keyed by `order_id + expected operational_revision + expected current status`.
2. An accepted transition increments canonical `operational_revision` exactly once. A competing transition built from the same prior revision is rejected as `stale_operational_revision`; equal revision is not allowed to overwrite a different canonical lifecycle state.
3. Extend the sync receipt/HTTP transport contract so a stale lifecycle delivery can return safe canonical reconciliation data (order id, canonical status, canonical operational revision, and the minimum lifecycle snapshot required locally). This conflict is a convergence event, not an endlessly retried transport failure.
4. Operations applies the canonical winner to local SQLite through an explicit reconciliation path before allowing further lifecycle mutation of that order. The local UI must not silently continue from a known stale lifecycle.
5. Admin `cancelActiveOrder` uses the same transition/CAS authority. It cannot cancel if canonical state is already DONE/CANCELLED/RETURNED and it cannot invent a higher revision without validating the prior state.
6. Offline ambiguity is resolved deterministically by the first transition accepted by canonical CAS; the losing stale event is reconciled locally and never overwrites the winner.

**RED tests:**

```ts
it('does not let stale local DONE overwrite an Admin cancellation', async () => {
  const localDone = fixtures.transitionFromRevision(4, 'ACTIVE', 'DONE');
  await admin.cancelActiveOrder({ orderId: 'o1', expectedRevision: 4, reasonCode: 'CUSTOMER_REQUEST' }, owner);
  const receipt = await sync.deliver(localDone);
  expect(receipt).toMatchObject({ decision: 'CONFLICT', canonicalStatus: 'CANCELLED', canonicalRevision: 5 });
  expect(remoteOrder.status).toBe('CANCELLED');
});

it('rejects Admin cancellation if Operations DONE won the same revision race', async () => {
  await sync.deliver(fixtures.transitionFromRevision(4, 'ACTIVE', 'DONE'));
  const result = await admin.cancelActiveOrder({ orderId: 'o1', expectedRevision: 4, reasonCode: 'CUSTOMER_REQUEST' }, owner);
  expect(result).toMatchObject({ ok: false, code: 'stale_operational_revision' });
});
```

**GREEN acceptance:** Admin and Operations cannot produce split-brain lifecycle truth; stale local outbox events converge to canonical state; existing idempotent replay remains valid; no finalized history is rewritten.

---

## Amendment 4: Propagate checkout/payment settings into canonical Menu and Operations execution

**Insertion point:** Execute with `2026-09-10-tux-admin-catalog-settings.md` Task 5 and Spec-Coverage-Hardening Task 5. Gate 2 is not complete until these consumers are green.

**Supersedes:** Any interpretation that persisting Admin checkout/payment settings alone satisfies the approved setting behavior.

**Files:**
- Modify planned: `supabase/migrations/20260910120000_admin_shop_settings.sql`
- Modify planned: `packages/admin-contracts/src/settings.ts`
- Modify existing: `packages/domain/src/*` configuration/order snapshot contracts as required
- Modify existing: `packages/application/src/configurationSync.ts`
- Modify existing: `packages/application/src/configurationSync.sqlite.test.ts`
- Modify existing: `packages/application/src/orders.ts`
- Modify existing: `packages/application/src/orders.test.ts`
- Modify existing: `packages/application/src/onlineOrderAcceptance.ts`
- Modify existing: `packages/application/src/onlineOrderAcceptance.test.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.test.ts`
- Modify existing: `apps/menu/src/lib/catalog-public.ts`
- Modify existing: `apps/menu/src/lib/order-intake.ts`
- Modify existing: `apps/menu/src/lib/checkout-attempt.ts`
- Modify existing: `apps/menu/src/components/cart/CartDrawer.tsx`
- Modify existing: `apps/menu/src/pages/OrderNow.tsx`
- Add/modify Menu tests and planned `e2e/admin-settings.spec.ts`

**Required contract:**

- Published configuration consumed by Menu and Operations includes effective per-shop minimum order, service charge, tax/VAT rule, delivery-fee behavior, discount-stacking policy, and channel/zone payment restrictions.
- Menu may render estimates and disable invalid choices, but the public order-intake/server boundary revalidates the effective checkout configuration against canonical published state.
- Operations POS placement and `prepareOnlineOrderAcceptanceDraft` revalidate the same effective rules before committing an order. Worker confirmation cannot bypass a disabled channel payment method or canonical minimum-order/tax/service rule.
- Future order snapshots persist the effective configuration version plus applied minimum-order decision, service charge, tax, delivery fee, discount/stacking decision, and payment-rule identity/value required to reconstruct the sale. Historical orders are untouched.
- `total_minor` is derived server-side from authoritative line subtotal, discounts, configured charges/tax, and delivery rules; browser-supplied totals are advisory only.
- Configuration sync/parser changes are additive and backward compatible with devices on older snapshots during rollout; unsupported/new fields fail closed only where financial correctness requires it.

**RED acceptance cases:**

- ONLINE rejects a POS-only payment method even when the browser submits it.
- POS and ONLINE both reject orders below the effective minimum.
- Service charge/tax changes published in Admin alter future canonical totals in both paths and leave prior order snapshots unchanged.
- Menu displays the same effective future total components that the trusted order-intake path recomputes.
- Shop overrides win over business defaults and the accepted order records the effective configuration version.

**GREEN gate:** run focused Menu checkout tests, `packages/application` POS/online tests, configuration-sync SQLite tests, remote-materializer tests, Admin settings E2E, catalog architecture gate, migrations, and existing root tests.

---

## Amendment 5: Integrate loyalty/promotions into real POS and ONLINE order placement

**Insertion point:** Execute with `2026-09-10-tux-admin-orders-customers-delivery.md` Task 4 and Spec-Coverage-Hardening Task 3. Gate 5 is not complete until both order channels consume the rules.

**Supersedes:** Any Admin-only promotion/loyalty implementation and the current ONLINE assumption that `discountMinor` is always zero.

**Files:**
- Modify planned: `supabase/migrations/20260910180000_admin_loyalty_promotions.sql`
- Modify planned: `packages/admin-contracts/src/loyalty.ts`
- Modify planned: `apps/admin/server/customers/loyaltyService.ts`
- Modify existing: `packages/domain/src/*` order/checkout snapshot contracts as required
- Modify existing: `packages/application/src/orders.ts`
- Modify existing: `packages/application/src/orders.test.ts`
- Modify existing: `packages/application/src/onlineOrderAcceptance.ts`
- Modify existing: `packages/application/src/onlineOrderAcceptance.test.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.ts`
- Modify existing: `packages/sync/src/remoteMaterializer.test.ts`
- Modify existing: `apps/menu/src/lib/order-intake.ts`
- Modify existing: `apps/menu/src/lib/checkout-attempt.ts`
- Modify existing: `apps/menu/src/components/cart/CartDrawer.tsx`
- Modify existing: `apps/menu/src/pages/OrderNow.tsx`
- Modify planned E2E: `e2e/admin-customers-promotions.spec.ts`
- Add cross-app POS/ONLINE promotion-loyalty E2E coverage.

**Required contract:**

- Promotion eligibility and loyalty redemption are evaluated at the trusted order-placement boundary from canonical customer/shop/channel/time/product/category state.
- Usage limits and loyalty balances are reserved/consumed atomically with order placement (or through a durable idempotent transaction boundary keyed by checkout/order intent) so two concurrent checkouts cannot overspend points or exceed a promotion limit.
- `PERCENT | FIXED | FREE_ITEM`, minimum order, start/end, business/shop scope, `POS | ONLINE | BOTH`, product/category eligibility, total/per-customer limits, and stacking policy affect both Operations POS and ONLINE acceptance.
- ONLINE acceptance must stop hard-coding `discountMinor: 0`; it reconstructs the trusted promotion/loyalty result and rejects stale or forged discount snapshots.
- The order persists applied promotion id/name/kind/rule snapshot, promotion discount, loyalty points redeemed/value, loyalty earn basis, and checkout configuration version required for immutable history.
- Loyalty earn posts only for the accepted/finalized business event defined by the reviewed loyalty policy and is idempotent by order/event id. Cancellation/refund/return uses explicit compensating loyalty ledger events rather than editing prior rows.
- Menu can quote eligibility/value, but final eligibility, usage count, balance, and total are server-authoritative.

**RED tests:**

```ts
it('prevents concurrent promotion uses from exceeding the final usage slot', async () => {
  const [a, b] = await Promise.all([placeOrder(lastSlotA), placeOrder(lastSlotB)]);
  expect([a, b].filter((x) => x.ok)).toHaveLength(1);
});

it('recomputes ONLINE promotion authority instead of trusting submitted discount', () => {
  expect(() => prepareOnlineOrderAcceptanceDraft(forgedDiscountFixture)).toThrow(/promotion|discount/i);
});

it('prevents concurrent loyalty redemption from overspending one balance', async () => {
  const results = await Promise.all([placeOrder(redeemA), placeOrder(redeemB)]);
  expect(results.filter((x) => x.ok)).toHaveLength(1);
});
```

**GREEN acceptance:** POS and ONLINE produce identical deterministic promotion/loyalty outcomes for the same eligible context; usage/balance concurrency is safe; order snapshots preserve applied rules; returns/refunds compensate rather than rewrite; existing non-promotional orders remain valid.

---

## Review Gate Added by This Addendum

Before any affected numbered plan is merged:

1. The amendment's RED tests must be observed failing for the intended missing behavior.
2. Implementation must make those tests GREEN without weakening existing Operations/Menu/Admin gates.
3. Review must verify the exact-head diff does not move live business-day or active-order execution authority out of Operations.
4. CI must include the relevant cross-app tests, not only Admin UI tests.
5. A reviewer must verify no older conflicting instruction from a numbered plan was implemented instead of this superseding amendment.

# TUX Admin Orders, Customers, Loyalty, Promotions, and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver safe order supervision/refunds, global customer identity and merge, loyalty/promotions/segments, and shop-safe delivery configuration/rider workflows.

**Architecture:** Keep canonical orders immutable and Operations-owned for live execution. Admin reads order detail and issues explicit cancel/refund/return commands. Introduce a business-level customer identity keyed by normalized Egyptian phone while preserving existing shop-scoped customer references through mappings. Delivery rules remain shop-scoped and server-authoritative for checkout/routing.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript BFF, React/TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- DONE/CANCELLED/RETURNED order history is immutable; corrections are new events.
- ACTIVE cancellation requires permission/reason and releases reserved stock.
- Refund/return is a new financial/order event and may require approval; it never rewrites the original payment.
- Egyptian phone forms normalize to one canonical identity.
- Same name alone never auto-merges customers.
- Delivery fee/minimum/shop routing are revalidated server-side; browser values are not authority.
- No live rider GPS.

---

### Task 1: Add Admin order read model and controlled cancel/refund commands

**Files:**
- Create: `packages/admin-contracts/src/orders.ts`
- Create: `apps/admin/server/orders/orderService.ts`
- Create: `apps/admin/api/admin/orders.ts`
- Create: `supabase/migrations/20260910160000_admin_order_controls.sql`
- Test: `apps/admin/server/orders/orderService.test.ts`
- E2E: `e2e/admin-orders.spec.ts`

**Interfaces:**
- Produces `searchOrders`, `getOrderDetail`, `cancelActiveOrder`, `requestRefund`, `returnOrderItems`.

- [ ] **Step 1: Write failing immutability tests**

```ts
it('rejects direct edits to a DONE order and exposes refund instead', async () => {
  const result = await service.cancelOrder({ orderId: 'o1', reasonCode: 'CUSTOMER_REQUEST' }, principal);
  expect(result).toMatchObject({ ok: false, code: 'order_not_active' });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/orders/orderService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement permission-safe order commands**

`cancelActiveOrder` must lock the order, require `orders.cancel`, enforce shop scope, append status/audit events, and invoke reservation release in the same transaction. Refund/return commands must create separate records referencing the original order/payment and route through approval thresholds when required.

- [ ] **Step 4: Verify order E2E and existing order tests**

```bash
npx vitest run apps/admin/server/orders/orderService.test.ts
npx playwright test e2e/admin-orders.spec.ts
npm test
npm run test:migrations
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/orders.ts apps/admin/server/orders apps/admin/api/admin/orders.ts supabase/migrations/20260910160000_admin_order_controls.sql e2e/admin-orders.spec.ts
git commit -m "feat(admin): add order supervision and refund controls"
```

### Task 2: Build order search/detail UI with contextual actions

**Files:**
- Create: `apps/admin/src/orders/OrdersPage.tsx`
- Create: `apps/admin/src/orders/OrderDetailPage.tsx`
- Create: `apps/admin/src/orders/CancelOrderSheet.tsx`
- Create: `apps/admin/src/orders/RefundReturnPage.tsx`
- Create: `apps/admin/src/orders/useOrders.ts`
- Test: `apps/admin/src/orders/OrderDetailPage.test.tsx`

**Interfaces:**
- Produces filters for date/shop/status/source/customer/worker/payment/order number and drillable order sections.

- [ ] **Step 1: Write failing action-visibility test**

```tsx
it('offers cancel for ACTIVE and refund for DONE', () => {
  const { rerender } = render(<OrderDetailPage order={{ ...fixture, status: 'ACTIVE' }} />);
  expect(screen.getByText('Cancel Order')).toBeTruthy();
  rerender(<OrderDetailPage order={{ ...fixture, status: 'DONE' }} />);
  expect(screen.getByText('Refund / Return')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/orders/OrderDetailPage.test.tsx
```

Expected: fail before components exist.

- [ ] **Step 3: Implement mobile list/full-detail and desktop inspector presentation**

Order detail must show items/modifiers/combo selections, customer, payment, delivery, inventory effect, status history, worker, and audit context. Sensitive actions live in a clearly separated action area and require reason/approval flow instead of inline record editing.

- [ ] **Step 4: Verify unit and responsive E2E**

```bash
npx vitest run apps/admin/src/orders/OrderDetailPage.test.tsx
npx playwright test e2e/admin-orders.spec.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/orders
git commit -m "feat(admin): add order search and detail UI"
```

### Task 3: Add canonical customer identity, addresses, merge, and segments

**Files:**
- Create: `supabase/migrations/20260910170000_admin_customers.sql`
- Create: `packages/admin-contracts/src/customers.ts`
- Create: `apps/admin/server/customers/phone.ts`
- Create: `apps/admin/server/customers/customerService.ts`
- Create: `apps/admin/api/admin/customers.ts`
- Test: `apps/admin/server/customers/phone.test.ts`
- Test: `apps/admin/server/customers/customerService.test.ts`

**Interfaces:**
- Produces `canonicalizeEgyptPhone`, `business_customers`, `customer_shop_links`, `customer_addresses`, `customer_segments`, `mergeCustomers`.

- [ ] **Step 1: Write failing phone normalization tests**

```ts
it.each(['01012345678', '+201012345678', '00201012345678', '201012345678'])(
  'normalizes %s',
  (input) => expect(canonicalizeEgyptPhone(input)).toBe('+201012345678'),
);
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/customers/phone.test.ts apps/admin/server/customers/customerService.test.ts
```

Expected: fail before implementation.

- [ ] **Step 3: Implement identity mapping and merge transaction**

The migration must map existing `(shop_id, normalized_phone)` contacts into business-level identities without breaking order references. `mergeCustomers` must lock both identities, require permission and confirmation, combine addresses/loyalty/shop links, redirect future lookup to the survivor, preserve all order snapshots, and append an audit event.

- [ ] **Step 4: Verify migration and merge tests**

```bash
npx vitest run apps/admin/server/customers/phone.test.ts apps/admin/server/customers/customerService.test.ts
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910170000_admin_customers.sql packages/admin-contracts/src/customers.ts apps/admin/server/customers apps/admin/api/admin/customers.ts
git commit -m "feat(admin): add canonical customer identity and merge"
```

### Task 4: Add CRM, loyalty, promotions, and customer-segment UI

**Files:**
- Create: `supabase/migrations/20260910180000_admin_loyalty_promotions.sql`
- Create: `packages/admin-contracts/src/loyalty.ts`
- Create: `apps/admin/server/customers/loyaltyService.ts`
- Create: `apps/admin/src/customers/CustomersPage.tsx`
- Create: `apps/admin/src/customers/CustomerDetailPage.tsx`
- Create: `apps/admin/src/customers/LoyaltyPanel.tsx`
- Create: `apps/admin/src/customers/SegmentsPage.tsx`
- Create: `apps/admin/src/promotions/PromotionsPage.tsx`
- Create: `apps/admin/src/promotions/PromotionEditor.tsx`
- Test: `apps/admin/server/customers/loyaltyService.test.ts`
- E2E: `e2e/admin-customers-promotions.spec.ts`

**Interfaces:**
- Produces loyalty ledger, one-order-level-promotion default rule, promotion windows/limits/shop/channel/product/category restrictions, and automatic segments.

- [ ] **Step 1: Write failing loyalty/promotion tests**

```ts
it('never allows a promotion to make the payable total negative', () => {
  expect(applyFixedDiscount({ subtotalMinor: 1000, discountMinor: 1500 })).toBe(0);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/customers/loyaltyService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement loyalty ledger and promotion validation**

Manual point changes require reason and audit. Promotion validation enforces start/end, minimum order, usage/customer limits, shop, source/channel, and product/category scope; by default only one order-level promotion applies. Segment computation supports New, Returning, VIP, Inactive 30 Days, Inactive 60 Days, Top Spenders, Frequent Delivery, and Loyalty Members.

- [ ] **Step 4: Verify E2E and migration suite**

```bash
npx vitest run apps/admin/server/customers/loyaltyService.test.ts
npx playwright test e2e/admin-customers-promotions.spec.ts
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910180000_admin_loyalty_promotions.sql packages/admin-contracts/src/loyalty.ts apps/admin/server/customers apps/admin/src/customers apps/admin/src/promotions e2e/admin-customers-promotions.spec.ts
git commit -m "feat(admin): add CRM loyalty promotions and segments"
```

### Task 5: Add delivery zones, routing, hours, riders, and delivery order states

**Files:**
- Create: `supabase/migrations/20260910190000_admin_delivery.sql`
- Create: `packages/admin-contracts/src/delivery.ts`
- Create: `apps/admin/server/delivery/deliveryService.ts`
- Create: `apps/admin/api/admin/delivery.ts`
- Create: `apps/admin/src/delivery/DeliveryPage.tsx`
- Create: `apps/admin/src/delivery/ZoneEditor.tsx`
- Create: `apps/admin/src/delivery/RidersPage.tsx`
- Create: `apps/admin/src/delivery/DeliveryOrderPanel.tsx`
- Test: `apps/admin/server/delivery/deliveryService.test.ts`
- E2E: `e2e/admin-delivery.spec.ts`

**Interfaces:**
- Produces server-authoritative zone matching and rider lifecycle `UNASSIGNED → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED | FAILED | RETURNED`.

- [ ] **Step 1: Write failing routing tests**

```ts
it('never silently falls back to another shop unless configured', async () => {
  const result = await service.routeAddress(address, { primaryShopClosed: true, fallbackEnabled: false });
  expect(result).toMatchObject({ ok: false, code: 'delivery_unavailable' });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/delivery/deliveryService.test.ts
```

Expected: fail before delivery service exists.

- [ ] **Step 3: Implement zone/routing/rider authority**

Reuse/extend existing `delivery_zones`; add geographic boundary representation, priority, hours, shop assignment, optional explicit fallback, rider records/status events, and delivery-order state history. Checkout must recompute fee/minimum/shop eligibility from the server result.

- [ ] **Step 4: Verify delivery integration**

```bash
npx vitest run apps/admin/server/delivery/deliveryService.test.ts
npx playwright test e2e/admin-delivery.spec.ts
npm run test:migrations
npm test
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910190000_admin_delivery.sql packages/admin-contracts/src/delivery.ts apps/admin/server/delivery apps/admin/api/admin/delivery.ts apps/admin/src/delivery e2e/admin-delivery.spec.ts
git commit -m "feat(admin): add delivery management and routing"
```

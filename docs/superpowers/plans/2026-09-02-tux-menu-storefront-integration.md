# TUX-MENU Storefront Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing `ahmedmohameda7222-ship-it/TUX-MENU` website from an independent cart-to-WhatsApp generator into the customer-facing storefront for the canonical TUX Web Order Bridge.

**Architecture:** TUX-MENU reads storefront-safe canonical configuration from the TUX backend, maintains structured cart selections using stable TUX IDs, and submits a `WEB_ORDER_REQUEST` before opening WhatsApp. The customer still presses Send in WhatsApp, but the message carries only a human-readable summary and stable WEB reference while authoritative cart data remains on the TUX backend.

**Tech Stack:** React 19, TypeScript 5.7, Vite 7, Supabase client only where still required for unrelated public features, Vitest + React Testing Library added for TDD, TUX public storefront/Web Order APIs.

**Spec:** `docs/superpowers/specs/2026-09-02-tux-customer-web-order-bridge-design.md`

**Binding expiry amendment:** `docs/superpowers/specs/2026-09-02-tux-web-order-expiry-decision.md`

**Companion core plan:** `docs/superpowers/plans/2026-09-02-tux-web-order-bridge-core.md`

## Global Constraints

- Do not maintain a second authoritative menu database in TUX-MENU.
- TUX-MENU never supplies authoritative prices to the backend; stable IDs/quantities/selections are submitted and server re-prices them.
- Website submission creates a request, not an official order.
- Customer-facing copy must say the request requires restaurant confirmation.
- Customer must explicitly press Send in WhatsApp.
- Known delivery zone: show configured fee and estimated total from canonical storefront config.
- Manual/Other area: show delivery fee and final total as pending confirmation; never guess.
- Known-zone minimum delivery order is enforced before normal request submission; delivery fee does not count toward the minimum.
- Payment selection is a preference until Operations accepts the request.
- Item notes and order notes remain structured fields.
- No AI, no free-text order extraction, no online card gateway, no customer accounts, no coupons/loyalty/scheduled orders in this plan.
- Storefront ordering availability must obey canonical enabled/paused/Pickup/Delivery controls.

---

### Task 1: Add a real TDD harness to TUX-MENU

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/lib/storefrontClient.test.ts`

**Interfaces:**
- Adds scripts `test` and `test:watch`.
- Uses `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, and `@testing-library/user-event`.

- [ ] **Step 1: Add the failing smoke test first**

```ts
import { describe, expect, it } from 'vitest';
import { buildStorefrontUrl } from './storefrontClient';

describe('buildStorefrontUrl', () => {
  it('joins the configured TUX API origin with storefront-config', () => {
    expect(buildStorefrontUrl('https://ops.example.com')).toBe(
      'https://ops.example.com/api/storefront-config',
    );
  });
});
```

- [ ] **Step 2: Run RED**

Run in TUX-MENU: `npm test -- src/lib/storefrontClient.test.ts`
Expected: FAIL because the test runner/module is not configured yet.

- [ ] **Step 3: Add test dependencies/config**

Add the dev dependencies and configure jsdom with `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 4: Implement the minimal URL helper**

```ts
export function buildStorefrontUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/storefront-config`;
}
```

- [ ] **Step 5: Run GREEN plus existing gates**

Run:

```bash
npm test -- src/lib/storefrontClient.test.ts
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Commit in TUX-MENU**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/lib/storefrontClient.ts src/lib/storefrontClient.test.ts
git commit -m "test: add storefront integration test harness"
```

---

### Task 2: Replace the independent long-term menu source with canonical storefront config

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Create: `src/lib/storefrontTypes.ts`
- Create: `src/lib/storefrontClient.ts`
- Create: `src/lib/storefrontClient.test.ts`
- Modify: `src/context/MenuContext.tsx`
- Create: `src/context/MenuContext.test.tsx`
- Retain fallback menu only as an explicit temporary unavailable-state fallback if approved for production; it must never silently override a canonical inactive/sold-out product.

**Interfaces:**
- Consumes `GET /api/storefront-config` from the companion core plan.
- Produces `StorefrontConfiguration` with canonical config version, products, categories, modifiers, combo options, order types, payment preferences, delivery zones, and online-ordering controls.

- [ ] **Step 1: Write RED client parsing tests**

Test that invalid/missing stable IDs, non-integer price minor units, or malformed delivery zones reject the payload rather than partially rendering a corrupted menu.

```ts
expect(() => parseStorefrontConfiguration({ products: [{ id: '', priceMinor: 12.5 }] })).toThrow();
```

- [ ] **Step 2: Write RED MenuContext test**

Mock the canonical endpoint with one active and one sold-out product; assert both canonical states are represented and no legacy fallback row with the same ID reappears.

- [ ] **Step 3: Implement client/parser**

Use one configured public API origin such as `VITE_TUX_API_ORIGIN`. Do not put service-role/provider/Admin secrets in Vite environment variables.

- [ ] **Step 4: Refactor MenuContext**

Replace direct `product_sections`/`products` authority with the canonical storefront endpoint. Keep image/description rendering but map from canonical IDs and availability state.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm test -- src/lib/storefrontClient.test.ts src/context/MenuContext.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storefrontTypes.ts src/lib/storefrontClient.ts src/lib/storefrontClient.test.ts src/context/MenuContext.tsx src/context/MenuContext.test.tsx
git commit -m "feat: consume canonical TUX storefront configuration"
```

---

### Task 3: Make cart selections fully structured with stable canonical IDs and notes

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Modify: `src/context/CartContext.tsx`
- Create: `src/context/CartContext.test.tsx`
- Modify: `src/components/order/ProductOrderCard.tsx`
- Modify any product-customization component that currently flattens extras into display-only strings.

**Interfaces:**
- Cart item retains `productId`, quantity, selected `modifierId` + quantity, combo beverage IDs, `itemNote`, and customer-visible display snapshot.
- Cart-level checkout state retains `orderNote` separately.

- [ ] **Step 1: Write RED cart identity tests**

Two visually identical products with different modifier selections must not merge incorrectly. Same product + same customization may merge quantity.

```ts
expect(cart.items).toHaveLength(2);
expect(cart.items[0]?.modifierSelections).not.toEqual(cart.items[1]?.modifierSelections);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/context/CartContext.test.tsx`
Expected: FAIL against the current `id`/extras-only model.

- [ ] **Step 3: Introduce canonical cart types**

```ts
export interface CartModifierSelection {
  readonly modifierId: string;
  readonly name: string;
  readonly quantity: number;
  readonly customerVisibleUnitPriceMinor: number;
}

export interface CartItem {
  readonly lineKey: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly modifierSelections: readonly CartModifierSelection[];
  readonly comboBeverageProductIds: readonly string[];
  readonly itemNote: string;
}
```

Compute `lineKey` from product/customization identity, not just product ID.

- [ ] **Step 4: Add item note UI**

Allow text such as `من غير بصل` per cart line and keep it in structured state/localStorage.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- src/context/CartContext.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/context/CartContext.tsx src/context/CartContext.test.tsx src/components/order/ProductOrderCard.tsx
git commit -m "feat: preserve structured cart selections"
```

---

### Task 4: Add canonical Delivery Zone, minimum-order, and pending-fee checkout UX

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx`
- Create: `src/components/cart/CartDrawer.test.tsx`
- Create: `src/lib/deliveryPricing.ts`
- Create: `src/lib/deliveryPricing.test.ts`

**Interfaces:**
- `resolveDeliveryQuote(subtotalMinor, zone)` returns either known fee/estimated total or pending fee state.
- `Other / fee to be confirmed` has no fake `zoneId` and no final total.

- [ ] **Step 1: Write RED delivery-pricing tests**

```ts
expect(resolveDeliveryQuote(35000, { feeMinor: 4000, minimumOrderMinor: 20000 })).toEqual({
  status: 'KNOWN',
  deliveryFeeMinor: 4000,
  estimatedTotalMinor: 39000,
});

expect(resolveDeliveryQuote(15000, { feeMinor: 4000, minimumOrderMinor: 20000 })).toMatchObject({
  status: 'BELOW_MINIMUM',
  missingMinor: 5000,
});
```

Add a test proving delivery fee itself cannot satisfy the minimum.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/lib/deliveryPricing.test.ts src/components/cart/CartDrawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Replace free-text-only delivery flow**

For Delivery, require:

1. `Delivery Area` select from enabled canonical zones plus `Other / مش لاقي منطقتك`.
2. Full delivery address.
3. Known zone fee/estimated total or pending-fee message.

- [ ] **Step 4: Render clear money states**

Known zone:

```text
Food subtotal  350 EGP
Delivery        40 EGP
Estimated total 390 EGP
```

Manual area:

```text
Food subtotal  350 EGP
Delivery        To be confirmed
Final total     Pending confirmation
```

Do not label a pending subtotal as `Total`.

- [ ] **Step 5: Enforce minimum before request submission**

Display `Minimum delivery order ... Add X EGP more.` and disable the order action until merchandise subtotal meets the configured minimum.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- src/lib/deliveryPricing.test.ts src/components/cart/CartDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/cart/CartDrawer.tsx src/components/cart/CartDrawer.test.tsx src/lib/deliveryPricing.ts src/lib/deliveryPricing.test.ts
git commit -m "feat: add structured delivery pricing UX"
```

---

### Task 5: Add online-ordering availability controls to storefront UX

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Modify: `src/context/MenuContext.tsx`
- Modify: `src/components/cart/CartDrawer.tsx`
- Create: `src/lib/onlineOrderingAvailability.ts`
- Create: `src/lib/onlineOrderingAvailability.test.ts`

**Interfaces:**
- Pure function returns `OPEN`, `PAUSED`, `CLOSED_BY_HOURS`, `PICKUP_DISABLED`, or `DELIVERY_DISABLED` using canonical shop-local configuration.

- [ ] **Step 1: Write RED availability tests**

Cover online ordering disabled, temporary pause, Pickup-only, Delivery-only, and outside configured opening hours.

- [ ] **Step 2: Implement pure availability function**

Do not compare opening hours using an assumed browser timezone if shop timezone is supplied by canonical config. Derive state using the configured shop timezone.

- [ ] **Step 3: Update checkout UI**

Keep menu browsing available while ordering is paused. Disable only unavailable order channels and show clear customer text before checkout.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/lib/onlineOrderingAvailability.test.ts src/components/cart/CartDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context/MenuContext.tsx src/components/cart/CartDrawer.tsx src/lib/onlineOrderingAvailability.ts src/lib/onlineOrderingAvailability.test.ts
git commit -m "feat: respect online ordering availability"
```

---

### Task 6: Submit structured WEB_ORDER_REQUEST before opening WhatsApp

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Create: `src/lib/webOrderClient.ts`
- Create: `src/lib/webOrderClient.test.ts`
- Create: `src/lib/webOrderPayload.ts`
- Create: `src/lib/webOrderPayload.test.ts`
- Modify: `src/components/cart/CartDrawer.tsx`
- Modify: `src/lib/constants.ts`

**Interfaces:**
- `createWebOrderRequest(payload)` POSTs stable IDs/quantities/notes/customer/request preferences and receives `{ webRef, createdAt, expiresAt, whatsappMessage }`.
- The API response—not client formatting—is the canonical prepared WhatsApp message.

- [ ] **Step 1: Write RED payload tests**

Assert payload includes stable IDs and excludes authoritative prices:

```ts
expect(payload.lines[0]).toMatchObject({ productId: 'product-1', quantity: 2 });
expect(payload.lines[0]).not.toHaveProperty('unitPriceMinor');
```

Display names/customer-visible prices may remain local UI context but are not sent as authority fields.

- [ ] **Step 2: Write RED checkout sequencing test**

Mock request creation and `window.open`. Assert WhatsApp is not opened until request creation succeeds and the URL contains the server-issued `WEB-*` reference in the prepared message.

- [ ] **Step 3: Implement request client**

POST to the configured TUX API origin. Treat backend validation errors as customer-readable checkout errors without clearing the cart.

- [ ] **Step 4: Replace current local WhatsApp-message construction**

Remove the current block that builds the authoritative order text directly from `items`. After successful request creation:

```ts
const encoded = encodeURIComponent(result.whatsappMessage);
window.open(`https://wa.me/${whatsappNumber}?text=${encoded}`, '_blank', 'noopener,noreferrer');
```

The customer still presses Send.

- [ ] **Step 5: Show correct confirmation language**

After launching WhatsApp, show:

`طلبك جاهز للإرسال على واتساب. الطلب بيتأكد بعد مراجعة المطعم.`

Do not show `Order confirmed`.

- [ ] **Step 6: Preserve cart on handoff failure**

If request creation fails or popup opening fails, keep cart/customer inputs available for retry. Do not create a second request on an immediate retry if a previously-created WEB ref is still associated with the unchanged checkout intent; use a client checkout-intent key to let the backend deduplicate duplicate submissions.

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm test -- src/lib/webOrderPayload.test.ts src/lib/webOrderClient.test.ts src/components/cart/CartDrawer.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/webOrderClient.ts src/lib/webOrderClient.test.ts src/lib/webOrderPayload.ts src/lib/webOrderPayload.test.ts src/components/cart/CartDrawer.tsx src/lib/constants.ts
git commit -m "feat: create structured web requests before WhatsApp handoff"
```

---

### Task 7: Add structured payment preference and order-level note semantics

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx`
- Modify: `src/lib/webOrderPayload.ts`
- Modify: corresponding tests.

**Interfaces:**
- Payload sends `paymentPreferenceId`/canonical value, never claims payment completion.
- Delivery with pending fee cannot present a final amount due.
- Adds `orderNote` as a distinct field from item notes.

- [ ] **Step 1: Write RED semantics tests**

For manual delivery + InstaPay preference, assert UI shows final total pending and payload contains payment preference only.

- [ ] **Step 2: Add order note input**

Label clearly, e.g. `Order note / ملاحظة على الأوردر`, and persist it with checkout state.

- [ ] **Step 3: Remove any UI wording that implies payment completion**

Use `Payment preference` or customer-friendly equivalent. A WhatsApp payment proof later remains a chat attachment and is not payment truth.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/lib/webOrderPayload.test.ts src/components/cart/CartDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/cart/CartDrawer.tsx src/lib/webOrderPayload.ts src/lib/webOrderPayload.test.ts src/components/cart/CartDrawer.test.tsx
git commit -m "feat: capture web order notes and payment preference"
```

---

### Task 8: Add storefront regression, accessibility, and production acceptance gates

**Repository:** `ahmedmohameda7222-ship-it/TUX-MENU`

**Files:**
- Create: `src/integration/checkoutFlow.test.tsx`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `WEB_ORDER_PRODUCTION_ACCEPTANCE.md`

**Interfaces:**
- Production config requires only public/non-secret `VITE_TUX_API_ORIGIN` plus existing public contact/display values.
- Acceptance validates browser/mobile checkout into real TUX backend + WhatsApp handoff.

- [ ] **Step 1: Add full checkout integration test**

Cover:

`load canonical config -> add canonical product/modifier -> choose known zone -> see fee/minimum -> submit request -> receive WEB ref -> open WhatsApp prepared message -> cart remains until explicit post-handoff behavior`.

Add a second flow for `Other` delivery area with pending fee/final total.

- [ ] **Step 2: Add accessibility checks in component tests**

Ensure zone/payment/order-type controls have labels, disabled state is explained, and pending/validation errors use `role="alert"` or appropriate live regions.

- [ ] **Step 3: Update environment/docs**

Document that menu/product/pricing authority is no longer the legacy local/Supabase storefront tables. Do not document or request service-role/provider secrets.

- [ ] **Step 4: Run complete TUX-MENU gate**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Real production acceptance**

Verify on phone and desktop browser:

1. Current canonical menu/availability matches TUX.
2. Sold-out/disabled items cannot be submitted.
3. Known-zone fee/minimum is correct.
4. Other area shows fee pending.
5. Request creates WEB ref before WhatsApp opens.
6. WhatsApp message contains readable summary + WEB ref.
7. Customer is told request awaits restaurant confirmation.
8. Operations receives/correlates the request and worker Review/Accept works.
9. A request older than two hours cannot later be accepted.
10. Repeated checkout click/retry does not create duplicate official orders.

- [ ] **Step 6: Commit**

```bash
git add src/integration/checkoutFlow.test.tsx README.md .env.example WEB_ORDER_PRODUCTION_ACCEPTANCE.md
git commit -m "test: gate TUX-MENU web order handoff"
```

---

## Cross-Repository Execution Order

1. Implement and deploy the canonical Web Order Bridge public config/request endpoints from `TUXCASHEIRNEW` first.
2. Implement this TUX-MENU plan against a non-production/test endpoint.
3. Run end-to-end correlation and Operations Review tests.
4. Only then switch the production TUX-MENU deployment to the new TUX API origin.
5. Do not delete/disable legacy storefront data until production acceptance proves canonical config parity and rollback strategy is documented.

## Plan Self-Review Result

- Spec coverage: canonical menu source, structured stable IDs, item/order notes, known/manual delivery, minimum order, payment preference, availability/paused channels, stable WEB reference, explicit WhatsApp Send, non-confirmed request copy, duplicate submission handling, and two-hour expiry awareness are covered.
- Type consistency: `StorefrontConfiguration` -> structured cart -> `WebOrderPayload` -> `createWebOrderRequest` -> server-issued WhatsApp message.
- The website never becomes an order authority and never parses WhatsApp text.
- TUX Admin controls are consumed through canonical config but Admin UI implementation remains a separate future project.

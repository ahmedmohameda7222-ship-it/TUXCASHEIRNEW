# TUX Web Order Bridge Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical backend and Operations Review/Accept path that turns a structured TUX-MENU request into exactly one normal TUX Operations order after worker review.

**Architecture:** TUX backend stores an immutable customer-visible request snapshot with a stable `WEB-*` reference and a two-hour server-authoritative expiry. WhatsApp correlates the request to a conversation, but the structured request—not message text—is the order authority. Operations Review revalidates against current configuration, surfaces changes, allows audited delivery-fee override, and converts the request through the existing `OperationsOrdersService`/local transaction/print/board/outbox pipeline with `source: 'ONLINE'`.

**Tech Stack:** TypeScript 6, Vitest 4, Supabase/Postgres migrations and server functions, Vercel API routes, existing TUX domain/application/persistence/sync packages, React Operations UI.

**Spec:** `docs/superpowers/specs/2026-09-02-tux-customer-web-order-bridge-design.md`

**Binding expiry amendment:** `docs/superpowers/specs/2026-09-02-tux-web-order-expiry-decision.md`

## Global Constraints

- Every web request expires exactly 2 hours after authoritative server creation time unless terminal earlier.
- `AWAITING_WHATSAPP`, `RECEIVED`, and `UNDER_REVIEW` all expire at the same `createdAt + 2h`; opening Review never pauses expiry.
- `ACCEPTED`, `REJECTED`, and `EXPIRED` are terminal.
- A request creates at most one official Operations order.
- WhatsApp text is never parsed to reconstruct website cart lines.
- Worker Review/Accept is mandatory; receipt of a WhatsApp message never auto-creates an order.
- Current configuration is authoritative at acceptance; original customer-visible values remain immutable audit context and material differences must be shown to the worker.
- Worker may override delivery fee; store both configured and final values plus worker/device/time and optional reason.
- Website payment method is a preference until the official order establishes final financial state.
- `OrderSource` for accepted website orders is existing `'ONLINE'`; normal cashier orders remain `'POS'`.
- No second official order engine. Accepted requests must use the existing local durable order commit, printing, stock, Orders Board, audit, outbox, and sync path.
- No AI, automatic text extraction, online card gateway, coupons, loyalty, scheduled orders, or GPS polygon pricing in this plan.
- TUX Admin UI implementation is not part of this plan; this plan adds the canonical configuration fields/contracts that future Admin will manage.

---

### Task 1: Define Web Order Request domain and canonical online-ordering configuration

**Files:**
- Create: `packages/domain/src/webOrderRequest.ts`
- Create: `packages/domain/src/webOrderRequest.test.ts`
- Modify: `packages/domain/src/catalog.ts`
- Modify: `packages/domain/src/configurationBundle.ts`
- Modify: `packages/domain/src/models.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces `WebOrderRequestStatus`, `WebOrderRequest`, `WebOrderLineSnapshot`, `WebOrderDeliverySnapshot`, `WebOrderPaymentPreference`.
- Extends `DeliveryZone` with `minimumOrderMinor: MoneyMinor | null`.
- Extends `OperationsConfigurationSnapshot` with `onlineOrdering` configuration needed by storefront and Review.
- Produces `expiresAtForWebOrder(createdAt): Instant` and `isWebOrderExpired(request, now): boolean`.

- [ ] **Step 1: Write RED lifecycle/expiry tests**

```ts
import { describe, expect, it } from 'vitest';
import { instant } from './time';
import { expiresAtForWebOrder, isWebOrderExpired } from './webOrderRequest';

it('expires exactly two hours after server creation', () => {
  const createdAt = instant(new Date('2026-09-02T18:00:00.000Z'));
  expect(expiresAtForWebOrder(createdAt)).toBe('2026-09-02T20:00:00.000Z');
  expect(isWebOrderExpired({ createdAt, status: 'RECEIVED' }, instant(new Date('2026-09-02T19:59:59.999Z')))).toBe(false);
  expect(isWebOrderExpired({ createdAt, status: 'UNDER_REVIEW' }, instant(new Date('2026-09-02T20:00:00.000Z')))).toBe(true);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- packages/domain/src/webOrderRequest.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement request types and terminal-state rules**

Use explicit states:

```ts
export type WebOrderRequestStatus =
  | 'AWAITING_WHATSAPP'
  | 'RECEIVED'
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED';

export const WEB_ORDER_EXPIRY_MS = 2 * 60 * 60 * 1000;
```

Model the original customer-visible snapshot using stable product/modifier IDs, integer minor units, configuration version, notes, order type, known/manual delivery state, and payment preference.

- [ ] **Step 4: Add canonical online ordering config**

Add a config shape such as:

```ts
export interface OnlineOrderingConfiguration {
  readonly enabled: boolean;
  readonly pickupEnabled: boolean;
  readonly deliveryEnabled: boolean;
  readonly temporarilyPaused: boolean;
  readonly storefrontUrl: string | null;
}
```

Keep opening-hours representation deterministic and timezone-aware; if opening-hours rules are not already present elsewhere, represent them as shop-local weekly intervals rather than browser-local timestamps.

- [ ] **Step 5: Extend DeliveryZone**

```ts
export interface DeliveryZone {
  // existing fields...
  readonly minimumOrderMinor: MoneyMinor | null;
}
```

Update configuration parsers/tests so legacy rows/snapshots without this field parse to `null` only through an explicit backward-compatible parser rule.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- packages/domain/src/webOrderRequest.test.ts packages/domain/src/configurationBundle.family.test.ts`
Expected: PASS.

Run: `npm run typecheck -w @tux/domain`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/webOrderRequest.ts packages/domain/src/webOrderRequest.test.ts packages/domain/src/catalog.ts packages/domain/src/configurationBundle.ts packages/domain/src/models.ts packages/domain/src/index.ts
git commit -m "feat: define web order request domain"
```

---

### Task 2: Persist canonical online-ordering configuration and Web Order Requests remotely

**Files:**
- Create: `supabase/migrations/20260902HHMM00_web_order_bridge.sql`
- Create: `scripts/test-web-order-migration.mjs`
- Modify: `supabase/migrations/20260820104000_operations_configuration_publish.sql` only if repository migration policy permits editing unreleased history; otherwise add all changes in the new migration.
- Modify: `package.json`

**Interfaces:**
- Produces remote config fields for online ordering and delivery minimum.
- Produces `web_order_requests` and child snapshot rows or one validated JSON snapshot column.
- Unique public `web_ref` and unique acceptance-to-order relation.
- Server functions for create/read/correlate/review/accept/reject/expire.

- [ ] **Step 1: Write RED migration test**

Assert the new migration contains:

```js
assert.match(sql, /web_order_requests/i);
assert.match(sql, /web_ref/i);
assert.match(sql, /expires_at/i);
assert.match(sql, /accepted_order_id/i);
assert.match(sql, /unique/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /minimum_order_minor/i);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test-web-order-migration.mjs`
Expected: FAIL.

- [ ] **Step 3: Create schema with atomic terminal-state guards**

At minimum include:

```sql
status text not null check (status in (
  'AWAITING_WHATSAPP','RECEIVED','UNDER_REVIEW','ACCEPTED','REJECTED','EXPIRED'
)),
created_at timestamptz not null default now(),
expires_at timestamptz not null,
accepted_order_id uuid null,
check (expires_at = created_at + interval '2 hours')
```

Create a unique index on `web_ref`. Enforce one accepted order per request and prevent direct anonymous mutation of terminal state.

- [ ] **Step 4: Add server-side expiry function**

The acceptance function must evaluate database `now()` in the same transaction that claims the request. If `now() >= expires_at`, transition nonterminal request to `EXPIRED` and return an expired result; never rely on client clocks.

- [ ] **Step 5: Add canonical configuration publication fields**

Ensure the same published configuration consumed by Operations can expose storefront-safe categories/products/modifiers/order types/payment options/zones and online-ordering controls. Do not publish worker PIN hashes, device credentials, secrets, recipes if the storefront does not need them, or Admin-only internals.

- [ ] **Step 6: Run migration GREEN**

Run: `npm run test:migrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations scripts/test-web-order-migration.mjs package.json
git commit -m "feat: persist web order requests and online ordering config"
```

---

### Task 3: Add public storefront configuration and request-creation API

**Files:**
- Create: `server/storefrontGateway.ts`
- Create: `server/storefrontGateway.test.ts`
- Create: `api/storefront-config.ts`
- Create: `api/web-order-request.ts`
- Create: `server/webOrderRequestGateway.ts`
- Create: `server/webOrderRequestGateway.test.ts`

**Interfaces:**
- `GET /api/storefront-config` returns only public storefront configuration.
- `POST /api/web-order-request` accepts stable product/modifier IDs plus customer-entered request data and returns `{ webRef, createdAt, expiresAt, whatsappMessage }`.
- Server computes all monetary snapshots from canonical configuration; customer JSON never supplies authoritative prices.

- [ ] **Step 1: Write RED security/price-authority tests**

Submit a payload that lies about product price and assert the response uses server configuration:

```ts
const response = await createRequest({
  lines: [{ productId, quantity: 2, claimedUnitPriceMinor: 1 }],
});
expect(response.snapshot.lines[0]?.unitPriceMinor).toBe(configuredPriceMinor);
```

Also test sold-out/inactive product rejection and disabled/paused channel rejection.

- [ ] **Step 2: Run RED**

Run: `npm test -- server/storefrontGateway.test.ts server/webOrderRequestGateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement storefront-safe config projection**

Return categories, products, images/descriptions, allowed modifiers, combo choices, order-type availability, customer-visible payment preferences, delivery zones/fees/minimums, and online ordering availability. Exclude inventory recipe quantities and any auth material.

- [ ] **Step 4: Implement request creation**

Validate every ID against current config, compute subtotal/delivery estimate in integer minor units, generate an opaque non-secret ref like `WEB-<random>`, set `createdAt`/`expiresAt` on server, persist immutable request snapshot, and produce the human-readable WhatsApp message from the stored snapshot.

For a manual/Other delivery area, snapshot `configuredDeliveryFeeMinor: null` and `estimatedTotalMinor: null` rather than guessing.

- [ ] **Step 5: Add delivery minimum rule**

Known-zone Delivery requests below `minimumOrderMinor` are rejected before request creation. Delivery fee does not count toward the minimum.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- server/storefrontGateway.test.ts server/webOrderRequestGateway.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/storefrontGateway.ts server/storefrontGateway.test.ts server/webOrderRequestGateway.ts server/webOrderRequestGateway.test.ts api/storefront-config.ts api/web-order-request.ts
git commit -m "feat: add storefront and web order request API"
```

---

### Task 4: Correlate WEB references from WhatsApp without parsing orders from message text

**Files:**
- Modify: `server/whatsappWebhook.ts`
- Modify: `server/whatsappWebhook.test.ts`
- Create: `server/webOrderCorrelation.ts`
- Create: `server/webOrderCorrelation.test.ts`

**Interfaces:**
- `extractWebReference(text): string | null` extracts only the opaque `WEB-*` correlation token.
- `correlateWebRequest({ webRef, shopId, normalizedSenderPhone, conversationId, now })` attaches request to the provider conversation and moves `AWAITING_WHATSAPP -> RECEIVED` if still eligible.
- It never parses products/quantities/extras from WhatsApp text.

- [ ] **Step 1: Write RED extraction tests**

```ts
expect(extractWebReference('Order Ref: WEB-A73K9')).toBe('WEB-A73K9');
expect(extractWebReference('عايز ٢ برجر')).toBeNull();
```

- [ ] **Step 2: Write RED correlation tests**

Prove wrong shop, expired ref, already-terminal request, and sender mismatch cannot attach silently. For the intended flow, provider sender phone becomes the primary communication identity and attaches to the existing conversation.

- [ ] **Step 3: Implement correlation**

Correlation may recognize the ref token but must load all structured order data from `web_order_requests`. If the request expired before the message arrives, mark/retain `EXPIRED` and leave the chat as a normal direct conversation.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- server/webOrderCorrelation.test.ts server/whatsappWebhook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/webOrderCorrelation.ts server/webOrderCorrelation.test.ts server/whatsappWebhook.ts server/whatsappWebhook.test.ts
git commit -m "feat: correlate website requests with WhatsApp"
```

---

### Task 5: Build Review revalidation and change-diff service

**Files:**
- Create: `packages/application/src/webOrderReview.ts`
- Create: `packages/application/src/webOrderReview.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `packages/domain/src/webOrderReview.ts`
- Create: `packages/domain/src/webOrderReview.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- `reviewWebOrderRequest(request, currentConfig, now): WebOrderReview`
- `WebOrderReview` contains current valid draft input, blocking issues, and customer-visible diffs.
- Delivery override is represented separately from original snapshot and current configured fee.

- [ ] **Step 1: Write RED revalidation matrix tests**

Cover:

```ts
it('flags product price change');
it('blocks sold-out product');
it('blocks removed modifier');
it('flags configured delivery fee change');
it('blocks disabled delivery channel');
it('expires at exactly createdAt + 2h');
it('does not mutate original request snapshot');
```

- [ ] **Step 2: Run RED**

Run: `npm test -- packages/domain/src/webOrderReview.test.ts packages/application/src/webOrderReview.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pure diff/revalidation domain logic**

Create explicit diff records such as:

```ts
export type WebOrderReviewDiff =
  | { kind: 'PRODUCT_PRICE_CHANGED'; productId: ProductId; requestedMinor: MoneyMinor; currentMinor: MoneyMinor }
  | { kind: 'DELIVERY_FEE_CHANGED'; zoneId: DeliveryZoneId; requestedMinor: MoneyMinor; currentMinor: MoneyMinor }
  | { kind: 'ITEM_UNAVAILABLE'; productId: ProductId };
```

Do not hide a material change by silently rewriting the request.

- [ ] **Step 4: Build a normal OrderDraft from the validated request**

Use existing product/modifier/combo domain operations rather than manually constructing unchecked line snapshots. Set `checkoutIntentKey` deterministically from request identity, e.g. `web-order:${request.id}`, so acceptance retries converge on the same order.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- packages/domain/src/webOrderReview.test.ts packages/application/src/webOrderReview.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/webOrderReview.ts packages/domain/src/webOrderReview.test.ts packages/domain/src/index.ts packages/application/src/webOrderReview.ts packages/application/src/webOrderReview.test.ts packages/application/src/index.ts
git commit -m "feat: revalidate web order requests for review"
```

---

### Task 6: Extend normal order placement to accept an explicit source without creating a second engine

**Files:**
- Modify: `packages/application/src/orders.ts`
- Create: `packages/application/src/ordersSource.test.ts`
- Modify: `packages/platform-contracts/index.d.ts`
- Update any preload result type test only if its structural parser asserts the full method signature.

**Interfaces:**
- Changes `placeOrder` to accept an optional second argument:

```ts
async placeOrder(
  draft: OrderDraft,
  options: { readonly source?: OrderSource } = {},
): Promise<OrderPlacementResult>
```

- Existing POS callers omit options and remain `source: 'POS'`.
- Web Order acceptance calls `{ source: 'ONLINE' }`.

- [ ] **Step 1: Write RED compatibility/source tests**

Prove existing `placeOrder(draft)` creates `POS`, while `placeOrder(draft, { source: 'ONLINE' })` creates `ONLINE`, with identical local transaction, inventory, audit, outbox, and print behavior.

- [ ] **Step 2: Run RED**

Run: `npm test -- packages/application/src/ordersSource.test.ts`
Expected: FAIL because `placeOrder` does not accept source and currently hard-codes `POS`.

- [ ] **Step 3: Implement minimal source option**

Replace:

```ts
source: 'POS',
```

with:

```ts
source: options.source ?? 'POS',
```

Do not fork the remaining checkout code.

- [ ] **Step 4: Run full Orders regression**

Run: `npm test -- packages/application/src/ordersSource.test.ts packages/application/src/ordersAtomicDelivery.sqlite.test.ts apps/operations/src/app/OrdersWorkspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/orders.ts packages/application/src/ordersSource.test.ts packages/platform-contracts/index.d.ts
git commit -m "feat: support online source in normal order placement"
```

---

### Task 7: Build atomic Review/Accept/Reject application flow with delivery-fee override

**Files:**
- Create: `packages/application/src/webOrderAcceptance.ts`
- Create: `packages/application/src/webOrderAcceptance.test.ts`
- Modify: `packages/application/src/index.ts`
- Create: `server/webOrderOperationsGateway.ts`
- Create: `server/webOrderOperationsGateway.test.ts`
- Create: `api/web-order-review.ts`

**Interfaces:**
- `beginReview(webRef)` claims/returns current review state.
- `accept(input)` atomically checks expiry/terminal status, records optional delivery override audit, calls normal local order placement exactly once, and records resulting official Order ID remotely.
- `reject(webRef, reason?)` terminally rejects without official order creation.

- [ ] **Step 1: Write RED two-hour race tests**

Use a request created at 18:00. Review opened at 19:59. Acceptance at 20:00 must return `EXPIRED` and call `placeOrder` zero times.

- [ ] **Step 2: Write RED exactly-once tests**

Two concurrent/retried accept calls for one request must return the same official order ID; `OperationsOrdersService.placeOrder` receives deterministic checkout intent and produces one local order.

- [ ] **Step 3: Write RED delivery override audit test**

```ts
expect(audit).toMatchObject({
  configuredFeeMinor: 4000,
  finalFeeMinor: 5500,
  workerId,
  deviceId,
  reason: 'Far edge of zone',
});
```

Reason is optional; worker/device/time/old/new fee are mandatory when values differ.

- [ ] **Step 4: Implement acceptance coordinator**

Do not hold a remote database transaction open around the local SQLite commit. Use a durable claim/idempotency protocol: atomically claim eligible request by request ID/web ref; local placement uses deterministic checkout intent; remote finalize stores official Order ID; retries recover either the existing local order or finalized remote link.

- [ ] **Step 5: Implement reject**

Reject transitions only nonterminal, unexpired requests. It sends no WhatsApp message automatically; it only makes a deterministic rejection quick reply available through the WhatsApp subsystem.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- packages/application/src/webOrderAcceptance.test.ts server/webOrderOperationsGateway.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/webOrderAcceptance.ts packages/application/src/webOrderAcceptance.test.ts packages/application/src/index.ts server/webOrderOperationsGateway.ts server/webOrderOperationsGateway.test.ts api/web-order-review.ts
git commit -m "feat: add web order review and acceptance coordinator"
```

---

### Task 8: Add Operations Review UI inside the WhatsApp conversation

**Files:**
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Create: `apps/operations/src/app/WebOrderReviewPanel.tsx`
- Create: `apps/operations/src/app/WebOrderReviewPanel.test.tsx`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Modify: `packages/platform-contracts/index.d.ts`
- Modify desktop IPC/preload files introduced by the WhatsApp plan to expose `webOrderReview` API.

**Interfaces:**
- `TuxWebOrderReviewApi.load(webRef)` returns immutable requested snapshot + current review + diffs.
- `accept({ webRef, finalDeliveryFeeMinor, overrideReason })`.
- `reject({ webRef, reason })`.

- [ ] **Step 1: Write RED UI tests for requested vs current values**

Render a price change and assert both values are visible before Accept:

```ts
expect(screen.getByText('Customer saw: 180 EGP')).toBeTruthy();
expect(screen.getByText('Current: 190 EGP')).toBeTruthy();
```

- [ ] **Step 2: Add delivery review controls**

Known zone shows configured fee and editable final fee. Manual/Other area requires worker to set final fee/zone before acceptance. If final differs, show optional reason field.

- [ ] **Step 3: Add blocking issues**

Sold-out/removed item, invalid modifier, disabled channel, expired request, or unmet current validation must disable Accept and explain the issue. `EXPIRED` cannot be revived.

- [ ] **Step 4: Add Accept/Reject actions**

On successful Accept, replace the request card with official `Order #N` context and expose the existing `View Order` action. Make the Egyptian confirmation quick reply available in the composer but do not auto-send.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- apps/operations/src/app/WebOrderReviewPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/operations/src/app/WebOrderReviewPanel.tsx apps/operations/src/app/WebOrderReviewPanel.test.tsx apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/sessionClient.ts packages/platform-contracts/index.d.ts apps/operations-desktop/src/main apps/operations-desktop/src/preload
git commit -m "feat: add worker web order review panel"
```

---

### Task 9: Add provenance, metrics readiness, and end-to-end regression gates

**Files:**
- Modify: remote web-order migration with a new follow-up migration if schema was already committed/applied during task execution.
- Create: `e2e/web-order-review.spec.ts`
- Create: `scripts/test-web-order-security.mjs`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/WEB_ORDER_BRIDGE_PRODUCTION_ACCEPTANCE.md`

**Interfaces:**
- Every accepted request can reconstruct web ref, shop, creation/config version, original snapshot, WhatsApp conversation/sender, review worker, diffs, override, acceptance worker/device/time, terminal status, and official Order ID.
- Metrics data exists without building the Admin analytics UI.

- [ ] **Step 1: Add E2E fake-provider flow**

Test:

`create request -> no official order -> correlate WhatsApp -> Review -> price/fee diff visible -> override -> Accept -> exactly one ONLINE order -> Orders Board sees same order -> confirmation reply available but unsent`.

- [ ] **Step 2: Add expiry E2E**

Use a controllable server clock/fake repository clock to prove a 2-hour-old request cannot be accepted even if Review began earlier.

- [ ] **Step 3: Add source/security assertions**

Fail CI if public storefront endpoints expose worker PIN hashes, device/session credentials, service-role secrets, or provider access tokens.

- [ ] **Step 4: Run full repository gate**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:migrations
npm run test:e2e
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Add production acceptance checklist**

Require a real TUX-MENU request and WhatsApp correlation, worker Review, known-zone fee, manual-zone pending fee, price-change warning, fee override audit, exact-once Accept/retry, rejected request, two-hour expiry, normal print/board/sync behavior, and failure isolation.

- [ ] **Step 6: Commit**

```bash
git add e2e/web-order-review.spec.ts scripts/test-web-order-security.mjs .github/workflows/ci.yml docs/WEB_ORDER_BRIDGE_PRODUCTION_ACCEPTANCE.md supabase/migrations
git commit -m "test: gate web order bridge behavior"
```

---

## Execution Dependency: TUX Admin

This core plan intentionally does **not** create TUX Admin screens. It creates the canonical fields/contracts that Admin will later manage: online ordering enabled/paused state, Pickup/Delivery switches, opening hours, delivery-zone availability/fee/minimum, and storefront URL/configuration. Until the separate Admin project implements those controls, production rollout of customer online ordering must not rely on ad-hoc Operations UI; configuration can only be seeded through the controlled deployment/admin data process agreed for the environment.

## Plan Self-Review Result

- Spec coverage: lifecycle, exact two-hour expiry, structured authority, Review/Accept, current-config revalidation, price/availability diffs, known/manual delivery, fee override/audit, minimum order, payment preference, customer identity correlation, structured notes, rejection, exactly-once conversion, `ONLINE` order source, provenance, metrics readiness, and failure isolation are mapped to tasks.
- Type consistency: web request domain -> remote schema/API -> correlation -> review -> deterministic normal `OrderDraft` -> existing `placeOrder(..., { source: 'ONLINE' })` -> UI.
- No second official order engine is introduced.
- Admin UI, storefront React changes, AI, GPS pricing, payments gateway, loyalty/coupons, and scheduled orders are outside this plan.

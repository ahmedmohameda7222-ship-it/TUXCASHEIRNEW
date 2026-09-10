# TUX Admin Review Hardening Addendum 4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Every amendment below is mandatory at its insertion point and follows RED → GREEN TDD.

**Goal:** Close the five remaining exact-head P1 findings without expanding approved product scope: keep employee PIN material out of approval/audit history, project canonical POS/ONLINE payments and refunds into tracked finance accounts exactly once, guarantee execution of the root WhatsApp event dispatcher, proactively converge Admin order cancellations into idle Operations clients, and define an online reservation boundary for globally limited POS promotions/loyalty redemption.

**Authority:** This file is a reviewed execution amendment and is mandatory together with the earlier hardening files. Where an older numbered plan or earlier hardening instruction omits or conflicts with these requirements, this later addendum supplies the required execution detail while the approved design specification remains authoritative.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Raw PINs are request-memory-only secrets. They are never persisted in approval requests, execution jobs, audit JSON, logs, error text, or durable command envelopes.
- Tracked finance balances cannot be called authoritative unless canonical operational payment/refund events are mapped and projected into the finance ledger exactly once.
- Durable queues require an independently invoked production runner; creation of a route or queue row alone is not execution.
- A remote Admin cancellation must converge into an online idle Operations client without waiting for that client to emit a conflicting lifecycle event.
- A POS transaction cannot consume globally scarce promotion usage or loyalty balance offline. Any shared limited entitlement requires a canonical online reservation before local finalization.

---

## Amendment 14: Keep employee PIN changes secret-safe through approvals and audit

**Insertion point:** Execute with `2026-09-10-tux-admin-approvals-audit.md` Tasks 1–2 and `2026-09-10-tux-admin-plan-hardening.md` employee-PIN propagation work. Approval Gate 3 cannot pass until this is green.

**Supersedes:** Any generic approval behavior that serializes the original `setEmployeePin(..., newPin, ...)` input into `admin_approval_requests.command_payload` or duplicates credential verifier material into audit history.

**Files:**
- Modify planned: `supabase/migrations/20260910125000_admin_approvals_audit.sql`
- Modify planned: `packages/admin-contracts/src/approvals.ts`
- Modify planned: `apps/admin/server/approvals/approvalService.ts`
- Modify planned: `apps/admin/server/approvals/approvalExecutionService.ts`
- Modify planned employee credential service from Foundation/Plan Hardening.
- Add/modify approval + credential service tests and migration-security tests.

**Required secret-safe command contract:**

1. `newPin` is accepted only in the same-origin trusted Admin server request that performs PIN availability/collision validation. The plaintext value must not cross into any persistence DTO.
2. Before an approval request can be persisted, the trusted server converts the candidate PIN into the canonical one-way credential material already required by Foundation:
   - a salted PBKDF2-SHA256 verifier using the reviewed iteration count and a fresh random salt;
   - the server-secret HMAC lookup digest used for collision-safe lookup.
   The plaintext PIN is then discarded from the logical command representation.
3. A PIN-change approval uses a dedicated secret-safe command payload such as:

```ts
export type ApprovedEmployeePinChange = {
  commandId: string;
  employeeId: string;
  targetShopIds: string[];
  pinVerifierHash: string;
  pinLookupHash: string;
  expectedCredentialVersion?: number;
};
```

The exact field names may follow Foundation conventions, but no persisted field may contain `pin`, `newPin`, a reversible encryption of the PIN, or request-body residue.
4. The generic approval registry must have an explicit serializer per command type. Secret-bearing commands are deny-by-default: if no reviewed secret-safe serializer exists, approval creation fails with a stable internal/business error rather than falling back to `JSON.stringify(input)`.
5. `admin_audit_events.before_value`, `after_value`, `reason`, error metadata, and execution result payloads must not contain raw PIN, PBKDF2 verifier, HMAC lookup digest, salt, or other credential secret material. Audit stores only safe facts such as employee id, target scope, credential version changed, actor, approval linkage, and timestamp.
6. The durable execution job should reference the approval/command identity and must not duplicate the credential payload. If implementation requires command material in a separate trusted table, it remains service-role-only, browser-deny-by-default, and stores only one-way credential material.
7. Rejecting/expiring an approval never activates the pending credential material. Successful execution atomically applies the new verifier/lookup/version to the canonical employee and linked Operations-worker credential surfaces required by Plan Hardening.
8. Application logs and structured errors redact fields classified as credential material. Tests may use a sentinel PIN but must never print it on failure output intentionally.

**RED tests:**

```ts
it('never persists the plaintext PIN when a PIN reset requires approval', async () => {
  const sentinel = '482731';
  await service.requestEmployeePinChange({ employeeId: 'e1', newPin: sentinel }, owner);
  expect(JSON.stringify(await store.allApprovalRows())).not.toContain(sentinel);
  expect(JSON.stringify(await store.allExecutionRows())).not.toContain(sentinel);
  expect(JSON.stringify(await store.allAuditRows())).not.toContain(sentinel);
});

it('never writes credential verifier or lookup material into audit JSON', async () => {
  const change = await fixtures.approvedPinChange();
  await executor.execute(change.requestId);
  const auditText = JSON.stringify(await store.allAuditRows());
  expect(auditText).not.toContain(change.pinVerifierHash);
  expect(auditText).not.toContain(change.pinLookupHash);
});
```

Add a registry test proving a secret-bearing command without an explicit serializer is rejected instead of generically persisted.

**GREEN acceptance:** raw PINs exist only transiently in trusted process memory; approval persistence contains only the minimum one-way credential material required for eventual execution; execution jobs/audit/logs contain no credential secrets; approved credential propagation remains atomic and idempotent.

---

## Amendment 15: Project canonical operational payments/refunds into tracked finance accounts exactly once

**Insertion point:** Establish the mapping/projection foundation with the Plan 6 finance core, complete/read it in `2026-09-10-tux-admin-finance-reports.md` Tasks 1–2, and include it in Gate 7 reconciliation. If necessary, the final cross-app materializer hook is implemented when the finance core becomes available; no earlier Operations behavior is destructively changed.

**Supersedes:** Any Finance implementation that computes `MoneyPosition` only from Admin-origin account movements while canonical POS/ONLINE sales and refunds remain outside the tracked ledger.

**Existing authority:** `public.payments` and canonical order/refund business events remain authoritative transaction history. `finance_movements` is a derived/accounting-control projection and must not become a second payment source of truth.

**Files:**
- Modify planned finance-core migration from Workforce and/or additive Plan 7 finance migration.
- Modify existing trusted Operations remote materialization boundary only where needed to enqueue/project canonical payment/refund events.
- Modify planned: `packages/admin-contracts/src/settings.ts` / finance contracts for payment-method account mapping.
- Modify planned: `apps/admin/server/finance/financeService.ts`
- Add finance payment-projection service/RPC and focused tests.
- Add migration-chain/backfill/reconciliation tests.
- Modify planned Finance/Settings E2E as required.

**Required mapping and projection contract:**

1. Add a canonical Admin-managed mapping from each active payment method/shop to one tracked `finance_account_id` (for example `payment_method_finance_accounts`). The referenced account must be active and in the same business/shop scope.
2. Mapping follows actual configured method semantics rather than labels. `CASH` normally targets a CASH account; `CARD`/`DIGITAL` may target `PENDING_SETTLEMENT`, WALLET, or another reviewed account according to business configuration. Ambiguous `OTHER` methods require explicit mapping.
3. Do not invent historical mappings. If an active method has no mapping, Finance surfaces it as `UNMAPPED`/reconciliation-incomplete and must not claim `MoneyPosition` is fully reconciled.
4. Every canonical `public.payments` row produces exactly one SALE inflow projection keyed by stable source identity, e.g. `(source_kind='PAYMENT', source_id=payments.id, effect='SALE')`. A unique database invariant prevents duplicate movements across sync replay, backfill, retries, or concurrent workers.
5. Canonical refund/return money effects produce exactly one REFUND outflow projection keyed by the immutable refund/payment-return event identity. They do not mutate/delete the original SALE movement.
6. Projection occurs through a trusted server/database boundary after canonical payment/refund commit. It may be synchronous in the canonical materialization transaction or a durable replayable projection job, but a failed projection must be detectable/retryable and never silently lose the source event.
7. Existing historical canonical payment/refund rows are backfilled idempotently only after a valid mapping is available. Preserve original source ids and business timestamps/source links where possible. Re-running backfill creates no duplicates.
8. Changing a method-to-account mapping affects future postings. Existing finance movement history is not silently reclassified; any explicit correction is a compensating/approved finance event.
9. Settlements move already-recorded value from `PENDING_SETTLEMENT` to BANK/WALLET and optionally post fees; settlement must not create another SALE inflow.
10. `MoneyPosition` and account histories are derived from `finance_movements`, but reconciliation compares them to canonical payment/refund sources. Any unprojected source or unmapped active method is visible as a reconciliation gap.

**RED tests:**

```ts
it('projects a canonical payment once across materializer replay', async () => {
  await materialize(paymentEvent);
  await materialize(paymentEvent);
  expect(await finance.sourceMovementCount('PAYMENT', paymentEvent.paymentId, 'SALE')).toBe(1);
});

it('projects a refund as a compensating outflow without deleting the sale', async () => {
  await materialize(paymentEvent);
  await materialize(refundEvent);
  expect(await finance.sourceMovementCount('PAYMENT', paymentEvent.paymentId, 'SALE')).toBe(1);
  expect(await finance.sourceMovementCount('REFUND', refundEvent.refundId, 'REFUND')).toBe(1);
});
```

Add tests for POS and ONLINE sources, CASH/CARD/DIGITAL mappings, historical idempotent backfill, an unmapped-method reconciliation gap, and settlement-without-double-sale.

**GREEN acceptance:** tracked account balances reconcile to canonical operational payments/refunds plus management movements; sync replay/backfill cannot duplicate SALE/REFUND finance effects; missing mappings are explicit rather than silently omitted.

---

## Amendment 16: Give the root WhatsApp event dispatcher an authenticated production cron

**Insertion point:** Execute with `2026-09-10-tux-admin-whatsapp-operations.md` Task 4 and recheck in Reliability/Production Gate 10.

**Supersedes:** The wording `Modify: vercel.json only if ... needs the dispatcher route scheduled`. Scheduling is **required** because the durable queue otherwise has no guaranteed production runner.

**Files:**
- Modify existing: `vercel.json`
- Modify planned: `api/whatsapp-event-dispatch.ts`
- Modify planned: `server/whatsappEventMessaging.ts`
- Add/modify root deployment/scheduling test, e.g. `scripts/test-whatsapp-event-dispatch-deployment.mjs`
- Modify root `package.json`/CI command only as needed to execute the deployment test.

**Required production contract:**

1. Preserve the existing `/api/whatsapp-media-retention` cron entry unchanged unless separately reviewed.
2. Add exactly one root-backend Vercel cron entry:

```json
{ "path": "/api/whatsapp-event-dispatch", "schedule": "* * * * *" }
```

The one-minute cadence is the reviewed trigger cadence for accepted-order/delivery event messages; queue idempotency/leases prevent duplicate sending.
3. The route follows the existing root cron-auth convention used by `api/whatsapp-media-retention.ts`: require `Authorization: Bearer ${CRON_SECRET}` (or a deliberately reviewed equivalent) and reject missing/invalid credentials before claiming queue work.
4. The dispatcher accepts no caller-supplied message/customer/template payload. It derives due `whatsapp_event_send_intents` and canonical rule/template/customer/channel state server-side.
5. The deployment test parses root `vercel.json` and fails if media retention disappears, event dispatch is missing/duplicated/uses a different path or cadence, or the dispatcher route lacks the shared scheduler-auth check.
6. Concurrent or repeated cron invocations still obey the Task 4 durable claim/idempotency and provider-uncertainty rules; cron scheduling does not weaken those protections.

**RED tests:**

```ts
it('rejects an unauthenticated WhatsApp event-dispatch cron request', async () => {
  const result = await handleDispatchRequest({ authorization: undefined, cronSecret: 'secret' });
  expect(result.statusCode).toBe(401);
  expect(runDispatcher).not.toHaveBeenCalled();
});
```

Static deployment test must assert both root cron entries and exact dispatcher cadence.

**GREEN acceptance:** accepted canonical event intents are guaranteed an independently scheduled production drain path, unauthenticated callers cannot run it, and repeated cron execution remains at-most-once at the outbound-intent boundary.

---

## Amendment 17: Add a proactive canonical lifecycle feed for Admin cancellations

**Insertion point:** Execute with `2026-09-10-tux-admin-review-hardening.md` Amendment 3 before Orders Gate 5 is complete.

**Supersedes:** Receipt-only lifecycle reconciliation as sufficient convergence. Conflict receipts remain required, but they are the fallback for races—not the only way an Admin cancellation reaches Operations.

**Files:**
- Modify/add additive migration for lifecycle feed sequencing/cursor support if canonical `order_status_events` lacks a monotonic feed key.
- Modify existing trusted Operations API/server transport or add a device-authenticated lifecycle-feed endpoint.
- Modify existing: `packages/sync/src/httpTransport.ts`
- Modify existing: `packages/sync/src/remoteReceipt.ts` as needed.
- Modify existing/local persistence for per-shop/device lifecycle cursor.
- Modify existing: `packages/application/src/ordersBoard.ts`
- Modify Operations startup/reconnect/periodic sync integration and tests.
- Modify Admin cancellation E2E/cross-app tests.

**Required proactive convergence contract:**

1. Canonical lifecycle changes expose a monotonic, paginated shop-scoped feed. It may use an additive sequence on/alongside `order_status_events`, but `(shop, cursor)` ordering must be stable and gap-detectable. Admin cancellation inserts the same canonical lifecycle event/feed fact used by Operations transitions.
2. Operations persists a durable per-shop/device `lastAppliedLifecycleCursor` in SQLite. Feed application and cursor advancement are atomic locally; duplicate pages/events are idempotent.
3. An online Operations client pulls/catches up:
   - on app/device startup after authenticated session/config readiness;
   - immediately after reconnect;
   - periodically while online (reviewed implementation target: no slower than every 15 seconds for active-order screens);
   - before a network-available lifecycle mutation when its cursor may be stale;
   - after a lifecycle conflict receipt.
4. When a feed event says an order is canonically CANCELLED/DONE/RETURNED at a newer `operational_revision`, Operations applies that winner to local SQLite even if the device had no outgoing event. An ACTIVE order cancelled by Admin disappears from/updates the active preparation surface promptly and its stale action controls are disabled.
5. Feed application never rewrites immutable historical status events. It updates the local projection to the canonical winner and records the canonical revision/event snapshot needed for audit/display.
6. If Operations is physically offline, remote cancellation cannot be displayed until connectivity returns. On reconnect, lifecycle catch-up runs before further network-backed lifecycle handling. Any truly offline local transition that raced a remote cancellation still resolves through Amendment 3 canonical CAS; the loser reconciles.
7. Pagination/retry is gap-safe: a failed page does not advance beyond unapplied events, and reconnect resumes from the committed cursor.
8. The endpoint is device-authenticated/shop-scoped through existing Operations server/session authority; Admin/browser credentials cannot ask for arbitrary-shop feed data.

**RED tests:**

```ts
it('applies an Admin cancellation to an idle online Operations device without an outgoing event', async () => {
  local.seedActiveOrder({ id: 'o1', operationalRevision: 4 });
  await admin.cancelActiveOrder({ orderId: 'o1', expectedRevision: 4, reasonCodeId: 'customer-request' }, owner);
  await lifecycleSync.catchUp();
  expect(local.order('o1')).toMatchObject({ status: 'CANCELLED', operationalRevision: 5 });
});

it('replays duplicate lifecycle pages without duplicating local history or regressing status', async () => {
  await lifecycleSync.apply(page);
  await lifecycleSync.apply(page);
  expect(local.lastAppliedLifecycleCursor()).toBe(page.nextCursor);
  expect(local.canonicalEventCount(page.events[0]!.id)).toBe(1);
});
```

Add startup, periodic-online, reconnect, pagination-gap, stale local transition, and cross-shop authorization tests.

**GREEN acceptance:** an idle online POS converges to an Admin cancellation proactively; conflict receipts still resolve true races; offline devices catch up before further online handling; local/canonical lifecycle truth cannot remain split indefinitely while connected.

---

## Amendment 18: Require online reservation for globally limited POS promotions and loyalty redemption

**Insertion point:** Execute with `2026-09-10-tux-admin-review-hardening.md` Amendment 5, Orders/Customers/Delivery Task 4, and Reliability offline/concurrency work before Orders Gate 5 is complete.

**Supersedes:** Any requirement that a fully offline local-first POS can atomically consume canonical loyalty balance, per-customer/total promotion limits, or another shared scarce reward without an online reservation.

**Files:**
- Modify planned loyalty/promotion migration/RPCs.
- Add shared reward reservation contracts in domain/admin contracts as appropriate.
- Add trusted Operations server/API transport for reward reservation/finalization/release.
- Modify existing: `packages/application/src/orders.ts`
- Modify existing: `packages/application/src/orders.test.ts`
- Modify existing configuration/online-state UI integration.
- Modify existing: `packages/sync/src/remoteMaterializer.ts`
- Modify ONLINE placement path to reuse the same canonical reservation/atomic authority where sensible.
- Add cross-device/offline/reconnect tests and E2E.

**Required reservation contract:**

1. Any POS action that consumes shared scarce state requires an online canonical reservation before the local order is finalized. This includes:
   - loyalty point redemption;
   - promotion total-usage or per-customer usage limits;
   - any other promotion rule whose eligibility can be exhausted concurrently across devices/channels.
2. Create an idempotent reservation primitive keyed by a stable checkout/order-intent id. The trusted server atomically locks/checks canonical customer balance and promotion counters, reserves the permitted amount/usage, and returns an immutable reservation reference plus authoritative reward/discount snapshot and expiry.
3. Two devices/ONLINE checkouts racing for the last eligible usage or same remaining loyalty balance can create at most one conflicting reservation. The loser receives a stable business result such as `reward_not_available` or `loyalty_balance_changed`.
4. Operations stores the reservation reference with its local order intent. Canonical order materialization/finalization consumes that exact reservation once; sync replay cannot consume it twice. A reservation for another shop/customer/order intent is rejected.
5. An abandoned reservation has a bounded lease/expiry and is safely released by explicit cancellation or expiry/reaper logic. Releasing before canonical order finalization restores reserved shared capacity exactly once.
6. If the POS is offline or the reservation service is unreachable, loyalty redemption and globally limited promotions are disabled/fail closed with clear UI. The POS may continue ordinary local-first selling. A promotion with no shared mutable limit may be quoted/applied offline only if the reviewed rule is fully deterministic from the locally published immutable configuration; canonical materialization still verifies its snapshot.
7. No locally saved/served order may claim a limited reward without an already-confirmed reservation. Do not save first and hope to reject/reprice after food has been prepared.
8. If connectivity drops after reservation but before local save/finalization, retry with the same intent id returns the existing reservation/result. If the reservation expires before finalization, the POS must reacquire or remove the reward before final order commit.
9. Refund/return/cancellation after canonical finalization uses explicit compensating loyalty/promotion ledger events defined by Amendment 5; it does not resurrect/edit the original reservation row.
10. ONLINE ordering may place/reserve in one server transaction, but it must share the same canonical counter/balance invariants as POS so cross-channel races are safe.

**RED tests:**

```ts
it('allows only one POS device to reserve the final promotion use', async () => {
  const [a, b] = await Promise.all([
    rewards.reserve({ intentId: 'a', promotionId: 'p1', customerId: 'c1' }),
    rewards.reserve({ intentId: 'b', promotionId: 'p1', customerId: 'c2' }),
  ]);
  expect([a, b].filter((x) => x.ok)).toHaveLength(1);
});

it('does not permit loyalty redemption while POS is offline', async () => {
  connectivity.setOffline();
  const result = await orders.prepareCheckout({ loyaltyPointsToRedeem: 500 });
  expect(result).toMatchObject({ ok: false, code: 'reward_requires_online_reservation' });
});
```

Add tests for same-customer multi-device redemption, POS-vs-ONLINE last-slot race, retry-by-same-intent, abandoned expiry/release, network loss after reservation, and canonical materializer single consumption.

**GREEN acceptance:** limited rewards are never overspent across local-first devices/channels; offline normal POS selling remains available but scarce rewards fail closed; retries/reconnects converge on the same reservation; finalized orders carry immutable applied reward snapshots.

---

## Review Gate Added by This Addendum

Before affected checkpoints merge:

1. Secret-bearing approved commands must prove raw PIN and verifier/lookup material do not leak into audit/log surfaces, and no generic serializer can persist a raw credential input.
2. Every canonical operational payment/refund must either have one finance projection or appear as an explicit reconciliation gap; tracked money cannot silently omit sales/refunds.
3. Root `vercel.json` must schedule the authenticated WhatsApp event dispatcher while preserving media retention scheduling.
4. Online idle Operations clients must proactively consume canonical lifecycle changes, including Admin cancellation, through a durable cursor/feed rather than relying only on conflict receipts.
5. Globally limited POS rewards/loyalty redemption must have an idempotent online reservation before local finalization; offline shared-limit consumption is prohibited.
6. Fresh exact-head CI and a fresh Codex review must pass with no unresolved serious finding.

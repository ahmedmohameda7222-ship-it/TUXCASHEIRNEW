# Production Sync and Online Claim Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore browser Operations delivery and recover safely from stale online-order reservations without duplicate claims.

**Architecture:** Bind default native fetch functions to `globalThis` at construction while leaving injected fetch implementations untouched. Classify reservation ownership as a conflict at the Edge boundary. Add a forward-only PostgreSQL migration that transfers only stale PENDING reservations under row locks, preserving the reserved processing Order ID.

**Tech Stack:** TypeScript, Chromium/Playwright, Vitest, Vite, Supabase Edge Functions, PostgreSQL migrations.

**Spec:** `docs/superpowers/specs/2026-10-24-production-sync-online-claim-recovery.md`

## Global Constraints

- Keep Branch + PIN and offline-first behavior unchanged.
- Preserve Order IDs, event idempotency, and shop/device isolation.
- Never clear IndexedDB, mutate live data, deploy, or merge.
- Require `APPLIED` or `REPLAY` before marking an outbox event delivered.
- Run focused tests only.

## Review Focus

- Native Chromium fetch invoked through a class field must retain the Window receiver; covered by Task 1 Chromium regression.
- Injected fetch doubles must remain unbound and observable; covered by Task 1 unit regressions.
- Empty/malformed 2xx sync receipts must remain retryable; covered by existing and Task 1 focused tests.
- Recent ownership and live PROCESSING claims must not transfer; covered by Task 3 PostgreSQL regression.
- Concurrent/stale takeover must preserve one processing Order ID and one owner within one shop; covered by Task 3 PostgreSQL regression.

---

### Task 1: Receiver-safe browser delivery

**Files:**

- Modify: `packages/sync/src/httpTransport.ts`
- Modify: `packages/sync/src/inventoryConvergence.ts`
- Modify: `packages/sync/src/orderLifecycleConvergence.ts`
- Test: `e2e/operations-sync-delivery.e2e.ts`
- Test: affected transport unit tests

**Interfaces:**

- Produces: receiver-safe default `fetch` behavior with unchanged injected `fetcher` behavior.
- Produces: Chromium proof from local Order creation through `/api/operations-sync`, canonical materialization, receipt, queue clearance, and Admin row mapping.

- [ ] Write and run a Chromium test that places an Order and expects a captured sync POST plus canonical Admin-visible row; confirm it fails with `Illegal invocation` and zero POSTs.
- [ ] Add unit cases that distinguish native default binding from injected fetch identity.
- [ ] Bind only the default browser fetch in outbox, inventory, and lifecycle transports.
- [ ] Run the focused Chromium and transport tests and commit.

### Task 2: Online-order Edge classification and protocol recovery

**Files:**

- Modify: `supabase/functions/online-order-operations/index.ts`
- Modify: `supabase/functions/online-order-operations/online-order-operations.ts`
- Test: `supabase/functions/online-order-operations/online-order-operations.test.ts`

**Interfaces:**

- Consumes: database ownership errors from Task 3's unchanged `TUX_ONLINE_ORDER_*` protocol names.
- Produces: HTTP 409 for ownership/transfer conflicts and the existing HTTP semantics for auth, invalid, not-found, and unavailable failures.

- [ ] Write failing handler tests for ownership classification and GET → CLAIM conflict → retry → PROCESSING → RELEASE flows.
- [ ] Move message classification into the testable Edge handler module and map ownership/transfer/release fencing to `CONFLICT`.
- [ ] Run focused Edge tests and commit.

### Task 3: Stale PENDING reservation takeover

**Files:**

- Create: `supabase/migrations/20261024080000_online_order_stale_reservation_recovery.sql`
- Modify: `scripts/test-online-order-origin-transfer.mjs`
- Test: focused migration/source contract tests

**Interfaces:**

- Consumes: the existing 12-hour processing lease and durable reservation schema.
- Produces: atomic stale takeover preserving `processing_order_id`; recent ownership still raises `TUX_ONLINE_ORDER_RESERVATION_OWNED`.

- [ ] Add PostgreSQL assertions for recent-owner conflict, stale PENDING takeover with identical Order ID, retry by the new owner, second-device conflict, release, and fresh successful claim.
- [ ] Run the regression against the pre-migration function and confirm the stale-takeover assertion fails.
- [ ] Add the forward-only claim-function migration with row-locked, shop-scoped, 12-hour staleness checks.
- [ ] Run focused migration tests where a local PostgreSQL fixture is available; otherwise require the repository CI migration gate and report the local environment limitation.
- [ ] Run targeted typechecks, lint/format, Chromium evidence, builds, and commit.
- [ ] Self-review the full branch, push it, create a Draft PR, and wait for required CI without deploying.

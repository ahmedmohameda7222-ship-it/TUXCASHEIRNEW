# Operations Sync Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operations preserve and automatically deliver pending Orders while reporting truthful, safe sync health.

**Architecture:** Keep the durable outbox authoritative. Each sync pass returns queue diagnostics computed from durable storage; authentication and network failures stay retryable, the scheduler can be triggered on reconnection, and UI state derives Offline from connectivity separately from delivery failure. Existing event IDs and idempotency keys remain unchanged through the Vercel and Supabase materialization path.

**Tech Stack:** TypeScript, IndexedDB/SQLite repositories, Vitest, Vercel Node gateway, Supabase Edge Function/Postgres RPC.

**Spec:** `docs/superpowers/specs/2026-10-24-operations-sync-recovery.md`

## Global Constraints

- Preserve offline-first checkout and existing Orders.
- Do not clear IndexedDB or modify live customer data.
- Do not change the Branch + PIN login UX.
- Run targeted tests only.
- No merge, production deployment, or live database changes.
- Create a Draft PR.

## Review Focus

- A temporary `401`/`403` must leave the event pending and retryable, not quarantine it.
- A delayed retry must keep the visible pending count nonzero and prevent `Synced`.
- A browser `online` event must trigger an immediate outbox pass without overlapping an in-flight pass.
- Branch-scoped diagnostics must not count or deliver another branch's events.
- A successful replay must retain the original event identity and produce the canonical order row Admin reads.

---

### Task 1: Durable delivery diagnostics and retry classification

**Files:**

- Modify: `packages/persistence/src/contracts.ts`
- Modify: `packages/persistence/src/browser/IndexedDbOperationsDatabase.ts`
- Modify: `packages/persistence/src/sqlite/SqliteOperationsDatabase.ts`
- Modify: `packages/sync/src/outboxSync.ts`
- Modify: `packages/sync/src/httpTransport.ts`
- Test: `packages/sync/src/httpTransport.test.ts`
- Test: `packages/sync/src/outboxSync.test.ts`

**Interfaces:**

- Produces: durable active-shop queue diagnostics on `OutboxSyncSummary`.
- Produces: retryable authentication failures while preserving permanent protocol quarantine.

- [ ] Write focused tests proving `401`/`403` remain retryable and delayed events remain counted.
- [ ] Run the tests and verify the new assertions fail for the expected classification/count reasons.
- [ ] Add the minimal repository/status and transport changes without altering event identity.
- [ ] Run the focused sync tests and verify they pass.
- [ ] Commit the task.

### Task 2: Reconnection and truthful browser status

**Files:**

- Modify: `packages/sync/src/scheduler.ts`
- Modify: `packages/sync/src/syncHealth.ts`
- Modify: `apps/operations/src/app/automaticSync.ts`
- Modify: `apps/operations/src/app/syncStatus.ts`
- Modify: `apps/operations/src/app/SyncStatusIndicator.tsx`
- Test: `packages/sync/src/scheduler.test.ts`
- Test: `packages/sync/src/syncHealth.test.ts`
- Test: `apps/operations/src/app/automaticSync.test.ts`
- Test: `apps/operations/src/app/syncStatus.test.ts`
- Test: `apps/operations/src/app/SyncStatusIndicator.test.tsx`

**Interfaces:**

- Consumes: `OutboxSyncSummary` queue diagnostics from Task 1.
- Produces: scheduler `trigger()` and safe UI diagnostics fields.

- [ ] Write failing tests for immediate reconnect retry, no overlap, Offline-vs-Retrying, pending-count gating, and diagnostic rendering.
- [ ] Run the tests and verify each fails for the intended missing behavior.
- [ ] Implement the minimal scheduler/status/UI changes.
- [ ] Run the focused browser and sync-health tests and verify they pass.
- [ ] Commit the task.

### Task 3: Gateway-to-Admin visibility regression coverage

**Files:**

- Test/modify as evidence requires: `server/supabaseGateway.ts`
- Test/modify as evidence requires: `supabase/functions/operations-sync/index.ts`
- Test: focused gateway/materializer/Admin order-store tests.

**Interfaces:**

- Consumes: unchanged sync envelope event ID/idempotency key.
- Produces: evidence that a retry reaches canonical materialization and the Admin order query surface.

- [ ] Add a focused failing integration/contract test for authenticated forwarding and canonical Order visibility through the Admin read model.
- [ ] Run it and verify the expected failure or document that existing behavior already passes and therefore needs no production change.
- [ ] Make only evidence-backed gateway/Edge changes, if required.
- [ ] Run all task-targeted tests, TypeScript checks for touched workspaces, ESLint/Prettier on touched files, and a production Operations build.
- [ ] Commit the task and prepare a Draft PR without deploying.

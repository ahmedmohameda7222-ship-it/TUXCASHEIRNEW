# TUX Menu Online Orders Integration Continuation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the already-started canonical Menu → online-order intake → Operations → WhatsApp integration on `work/menu-online-orders-integration` without regressing PR #54 WhatsApp behavior or applying external mutations.

**Architecture:** Keep the browser untrusted. The Menu submits canonical IDs and customer intent through the trusted public order-intake boundary; Supabase stores a PENDING online-order request; Operations receives that request through the authenticated device/server path, caches it locally, explicitly claims/reviews it, and only then converts it through existing Operations order-placement invariants. WhatsApp remains an independent messaging surface that resolves the same normalized Egyptian customer phone and existing order context.

**Tech Stack:** TypeScript, React, Electron, Vite, Vitest, Playwright, Supabase Edge Functions/PostgreSQL, repository architecture/security guards, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-tux-canonical-catalog-authority-design.md` plus the controller prompt for TUX Menu reconciliation and canonical online-order intake.

## Global Constraints

- Branch only: `work/menu-online-orders-integration`; never commit to `main` or frozen historical branches.
- Current `main` and merged PR #54 remain authoritative for Operations/WhatsApp behavior.
- No whole-branch Phase B merge, no force-push, no history rewrite.
- No remote Supabase migration/application, no Vercel deployment, no Meta configuration, no real WhatsApp send.
- Customer-facing Menu appearance is preserved; no redesign.
- Browser never inserts canonical order rows directly and never receives service-role credentials.
- Canonical catalog IDs and `priceMinor` remain authoritative; server re-prices every request.
- A web request is not a final POS order until Operations establishes missing Business Day/operator/delivery/payment/inventory facts.
- Delivery customer phone normalization must reuse canonical Egyptian semantics (`01XXXXXXXXX`).
- Existing PR #54 WhatsApp order-context service is reused; no duplicate WhatsApp-owned order persistence.
- TDD is mandatory for new behavior: RED evidence, minimal GREEN implementation, then refactor.

---

### Task 1: Finish the Electron online-order inbox IPC runtime

**Files:**
- Existing RED test: `apps/operations-desktop/src/main/onlineOrderInboxIpc.test.ts`
- Create: `apps/operations-desktop/src/main/onlineOrderInboxIpc.ts`

**Interfaces:**
- Consumes: `OperationsOnlineOrderInboxService` compatible methods `load()`, `claim(requestId)`, `release(requestId, processingOrderId)`, `reject(requestId, processingOrderId, reason)`, `subscribe(listener)`.
- Produces: trusted Electron IPC channels for load/claim/release/reject and one renderer change notification channel.

- [x] **Step 1: Write the failing test**

The branch already contains the RED contract in `onlineOrderInboxIpc.test.ts` at commit `bd71003b86844af385f7f2b516b224ea94d6ec11`.

- [x] **Step 2: Verify RED**

GitHub Actions run `34234754455` failed at `Unit and integration tests` while formatting/lint, monorepo architecture, Menu, and Windows packaging passed. The missing runtime is the intended failure.

- [ ] **Step 3: Implement the minimal runtime**

Implement four `ipcMain.handle` registrations. Every handler calls `assertTrustedIpcSender` before validating/delegating. Validate UUID-shaped request/processing IDs and a trimmed non-empty rejection reason. Subscribe once per registered BrowserWindow and emit the snapshot only while the window is alive. `close()` removes handlers and unsubscribes.

- [ ] **Step 4: Verify GREEN**

Use the branch push CI `quality` job; require the unit/integration step to pass before proceeding.

- [ ] **Step 5: Commit**

`feat(desktop): add online-order inbox IPC runtime`

### Task 2: Expose the inbox through the existing desktop preload/platform boundary

**Files:**
- Test first: `apps/operations-desktop/src/preload/index.test.ts` or the existing preload contract test location discovered in the repository.
- Modify: `apps/operations-desktop/src/preload/index.ts`
- Modify the existing platform-contract file that defines `window.tux` / desktop APIs; do not create a renderer-privileged Supabase client.
- Modify: `apps/operations-desktop/src/main/index.ts` only to instantiate/wire the application service and IPC runtime.

**Interfaces:**
- Consumes: Task 1 IPC channels and `OperationsOnlineOrderInboxService`.
- Produces: a narrow renderer API with `load`, `claim`, `release`, `reject`, and `subscribe`.

- [ ] **Step 1: Write failing contract tests** proving the preload invokes only the new IPC channels and validates subscription cleanup.
- [ ] **Step 2: Verify RED** in CI.
- [ ] **Step 3: Implement minimal preload/platform types and main-process wiring** using the authenticated remote gateway and local inbox store already present on the branch.
- [ ] **Step 4: Verify GREEN** including desktop typecheck/build and existing WhatsApp architecture/security tests.
- [ ] **Step 5: Commit** `feat(desktop): expose online-order inbox bridge`.

### Task 3: Add the minimal Operations incoming-web-order review surface

**Files:**
- Test first in the existing Operations app test structure.
- Reuse existing `apps/operations/src/app/onlineOrderInboxClient.ts` / runtime state instead of adding another order authority.
- Modify the smallest existing Orders Board shell/pane necessary; do not redesign Operations.

**Interfaces:**
- Consumes: desktop inbox bridge, cached PENDING/PROCESSING requests.
- Produces: visible ONLINE incoming request state with explicit claim/release/reject/accept affordances and no fabricated payment/delivery facts.

- [ ] **Step 1: Write failing UI/runtime tests** for PENDING vs PROCESSING, remote-unavailable cached state, and worker-visible missing authoritative facts.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement minimal surface** preserving POS/local behavior and offline-safe cached display.
- [ ] **Step 4: Verify GREEN** including Operations build and WhatsApp regressions.
- [ ] **Step 5: Commit** `feat(operations): receive online order intake`.

### Task 4: Convert a claimed request through existing Operations order-placement invariants

**Files:**
- Test first in `packages/application` and Operations integration tests.
- Reuse `OperationsOrdersService`, existing checkout/payment/business-day/inventory/audit/outbox code.
- Extend the online-order review service only where needed for acceptance/conversion.

**Interfaces:**
- Consumes: PROCESSING online request with trusted canonical item snapshots and authenticated current operator context.
- Produces: one durable final order with `source = ONLINE`, Business Day/display order number/current operator attribution, confirmed delivery/payment facts, inventory effects, audit/outbox, and idempotent request completion.

- [ ] **Step 1: Write failing conversion tests** proving missing zone/fee/payment/operator facts block finalization and retries do not duplicate the order.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement minimal conversion orchestration** by calling existing application services rather than duplicating accounting in React.
- [ ] **Step 4: Verify GREEN** including SQLite/browser persistence and migration-chain smoke.
- [ ] **Step 5: Commit** `feat(orders): convert reviewed web intake safely`.

### Task 5: Prove canonical customer/WhatsApp context reuse

**Files:**
- Extend existing WhatsApp order-context integration tests; do not create a second phone normalizer.
- Add only narrow plumbing required for the final ONLINE order to be discoverable by the PR #54 order-context service.

**Interfaces:**
- Consumes: final Delivery order phone `01XXXXXXXXX` and equivalent inbound Meta representation (`+20`, `0020`, `20`, or `01`).
- Produces: the same logical customer/order context, link/unlink, and fake-provider reply path.

- [ ] **Step 1: Write failing integration test** with equivalent phone representations.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement only missing adapter/query plumbing**; reuse `normalizeEgyptianPhone` and PR #54 context service.
- [ ] **Step 4: Verify GREEN** including WhatsApp architecture/security gates.
- [ ] **Step 5: Commit** `feat(whatsapp): resolve online delivery order context` only if code changes are actually required; otherwise commit only the regression test under the integration checkpoint.

### Task 6: Full local/fake-provider E2E and security matrix

**Files:**
- Extend `e2e/menu/menu.e2e.ts` and/or add a focused cross-app integration test harness under the repository's established E2E location.
- Add explicit security tests beside order-intake/catalog/desktop boundaries.

**Interfaces:**
- Consumes: real Menu renderer, trusted local/fake intake, Operations inbox/conversion, fake Meta provider.
- Produces: automated proof for one submit, duplicate suppression, Operations visibility/conversion, ONLINE source, same customer phone context, link, and fake reply.

- [ ] **Step 1: Add RED tests** for the complete happy path plus price/total tampering, cross-shop ID, inactive/sold-out product, invalid modifier relation, duplicate idempotency, malformed phone, unsupported order type, oversized fields, unauthorized Operations API, service-role leakage, direct browser order-table mutation, and privileged catalog mutation.
- [ ] **Step 2: Verify RED only for genuinely missing behavior**.
- [ ] **Step 3: Implement the narrow missing protections/plumbing**.
- [ ] **Step 4: Verify GREEN** across unit/integration, Menu E2E, catalog/order-intake tests, Operations, WhatsApp gates, and migration smoke.
- [ ] **Step 5: Commit** `test(integration): prove menu operations whatsapp journey`.

### Task 7: Visual parity and repository closeout

**Files:**
- Keep visual changes inside existing Menu visual language only.
- Add/update rendered Playwright evidence and closeout documentation.
- Update permanent CI only if a required gate is not already present; never weaken existing gates.

**Interfaces:**
- Consumes: final functional branch.
- Produces: rendered desktop/mobile evidence, exact-head push CI, PR integration CI, and a draft PR only.

- [ ] **Step 1: Run/inspect rendered comparison evidence** for `/`, `/order-now`, `/tux-burger`, `/tuxify`, `/hawawshi`, `/fries`, `/combos`, `/drinks`, a representative product/deep link, and cart open at desktop and approximately `390x844`.
- [ ] **Step 2: Correct only demonstrated regressions** and rerun evidence.
- [ ] **Step 3: Run the complete permanent CI matrix** with exact-head push evidence and no `continue-on-error`.
- [ ] **Step 4: Record deployment prerequisites** and explicitly state `REMOTE MIGRATIONS APPLIED: NO` and external mutations `NONE`.
- [ ] **Step 5: Open DRAFT PR** `work/menu-online-orders-integration` → `main`; do not merge.

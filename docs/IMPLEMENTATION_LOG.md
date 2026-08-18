# TUX V2 Implementation Log

## 2026-08-17 — Phase 0 completed

- Confirmed target repository `ahmedmohameda7222-ship-it/TUXCASHEIRNEW` was genuinely empty.
- Created the one-time minimal bootstrap commit on `main`.
- Created `integration/tux-operations-v2` and `feat/ops-00-bootstrap`.
- Confirmed legacy repository `ahmedmohameda7222-ship-it/Tuxcashier` is available only as read-only reference.
- Added the canonical 5,376-line Operations Master Plan at `docs/TUX_V2_Operations_Master_Approved_Plan.md` without changing approved product behavior.
- Added the 120-row baseline compliance matrix, phase execution map and repository/editor conventions.
- Opened and squash-merged PR #1 from Phase 0 into integration.
- No product UI, Supabase remote work, secrets, or legacy code are part of Phase 0.

### Canonical source verification note

The attached canonical source used for Phase 0 has SHA-256 `8cad80ed1faa57f03da98a00710da5fac885755140e949a65bb2eb2e3fe2054a` and 5,376 lines. The GitHub connector-generated text blob has the same 5,376-line document structure and approved decision content, but its Git blob SHA differs from the source file's locally calculated Git blob SHA. This is recorded explicitly rather than falsely claiming binary identity; implementation authority remains the approved Master Plan content.

## 2026-08-17 — Phase 1 completed

- Created `feat/ops-01-foundation` from the Phase 0 integration head.
- Added npm workspaces, strict compiler baseline, ESLint, Prettier, Vitest, and a generated npm lockfile.
- Added the shared React Operations renderer and secure Electron main/preload shell.
- Hardened the Electron trust boundary: context isolation and sandbox on; renderer Node integration off; `webSecurity` on; webviews, new windows, and renderer navigation denied; development content limited to the fixed local Vite origin; IPC calls validated against the expected renderer main frame; renderer CSP added.
- Added a narrow typed desktop capability contract, runtime config validation, TUX design tokens, permanent CI, Architecture/Test Strategy docs, and foundation ADRs.
- Remote Supabase remained unconfigured and no remote migration was applied.
- Phase 1 was squash-merged into integration; documentation evidence was subsequently synchronized through its reviewed follow-up PR.

## 2026-08-17 — Phase 2 completed

- Created `feat/ops-02-domain-persistence` from the Phase 1 integration head.
- Added branded UUID identities, exact `MoneyMinor`, canonical `Instant`, and exact fixed-point `StockQuantityMicros` (`1 whole unit = 1,000,000 micros`).
- Added Business Day OPEN/CLOSED identity and Business-Day-scoped display-order allocation with no calendar-date reset logic.
- Added typed worker/device/session, menu/configuration, Order/payment, Expense, customer-contact, inventory, reconciliation, audit, and durable-outbox models.
- Added one runtime-independent `OperationsDatabase` transaction/repository contract.
- Added Node `node:sqlite` desktop persistence with versioned migrations, foreign keys, `synchronous = FULL`, explicit transactions/rollback, configuration snapshots, and local durability tests.
- Added browser IndexedDB persistence behind the same contract with versioned stores, strict durability hint, persistent-storage request, atomic configuration snapshot, customer contacts, and outbox state.
- Added normalized remote Postgres/Supabase migrations with tenant consistency, relational constraints/indexes, and RLS enabled. The migrations remain repository-only and unapplied; no V2 Supabase URL/key/project ref was added.
- Added Phase 2 architecture/data-model/offline/migration docs and ADRs 0003–0008.
- Removed temporary write-capable helper workflows before closeout.
- PR #4 was squash-merged into `integration/tux-operations-v2` as `10f15a057f5371987a4e2f7fb119fedfdd901a9d`.

## 2026-08-17 — Phase 3 completed

- Created `feat/ops-03-business-day-operator` from the Phase 2 integration squash commit.
- Added a narrow `OperatorSessionReadModel`; desktop uses a read-only SQLite query connection and browser fallback reads the current IndexedDB stores.
- Added `OperationsSessionService` with serialized `getState`, `submitPin`, and `signOut` behavior. Business Day/session mutations remain inside `OperationsDatabase.transaction()`.
- Valid PIN starts a new Business Day only when none is open; otherwise the worker joins the existing Business Day.
- Added durable Current Operator sessions, intentional PIN-based worker switch, and sign-out that ends the worker session without closing the Business Day.
- Added worker session audit/outbox events and `WORKER_SIGNED_OUT` to the domain audit vocabulary.
- Added SQLite migration v2 enforcing one open worker session per Business Day.
- Added versioned PBKDF2-SHA256 PIN verification for Node and browser fallback; no plaintext production PIN or hard-coded production shop/worker credential is present.
- Added narrow Electron session IPC and strict preload response validation rather than exposing raw IPC/SQLite.
- Added the approved no-active-day entry copy, time-aware greeting copy with a 1,250 ms transition, Current Operator menu, PIN switch flow, and sign-out UI. Full Orders behavior and End Day remain deliberately unimplemented.
- Replaced Electron's raw TypeScript emit with strict bundler-resolution typecheck plus Vite-bundled CommonJS main/preload outputs so ESM workspace source is not consumed incorrectly by CommonJS at runtime.
- Added tests for invalid-PIN no-mutation behavior, Business Day start/recovery/switch/sign-out, one-open-session database enforcement, greeting boundaries, PBKDF2 verification, and preload response validation.
- Removed all temporary Phase 3 lockfile/formatter helper workflows before clean validation.
- Permanent code-head CI run `32068287692` passed install, format, lint, strict typecheck, unit/integration tests, browser build, and Electron main/preload builds.
- PR #5 exact documentation head then passed the same permanent gate on run `32068544454`.
- The approved graphic TUX logo asset is not present in the V2 repository; the locked screen currently uses a typographic `TUX` fallback and START-001 is not claimed fully compliant.
- Phase 3 is ready for squash merge into `integration/tux-operations-v2`; `main` remains untouched.

## 2026-08-18 — Phase 4 Orders implementation completed, closeout in progress

- Created `feat/ops-04-orders` from the Phase 3 integration baseline and kept PR #6 targeted at `integration/tux-operations-v2`; `main` remains untouched.
- Added exact Orders draft primitives for pricing, fixed discounts, Cash/Instapay payment behavior, two-way split payments, Egyptian phone normalization, and smart Cash tender suggestions.
- Added durable `OrderDraftStore` adapters for SQLite desktop and IndexedDB browser fallback with revision conflict protection and stable checkout-intent identity for retry/crash recovery.
- Added domain draft operations for direct product +/- behavior, deterministic most-recent decrement, Sold Out enforcement, modifier eligibility/max quantities, required combo beverage selection, item-note customization, and delivery-zone fee snapshots.
- Added `OperationsOrdersService` with serialized workspace loading, durable draft saves, customer lookup, local-first checkout, idempotent replay recovery, and immutable-order reprint.
- Checkout validation occurs before business mutation. One local transaction allocates the Business-Day display number, writes immutable order/payment snapshots, appends inventory consumption, learns successful Delivery contacts, writes the audit event, and writes the durable `ORDER_PLACED` outbox event.
- Added integration coverage proving validation failure and injected local inventory persistence failure are mutation-free/rolled back and preserve the durable draft.
- Added idempotency coverage proving stale committed intents do not duplicate order/inventory/outbox effects and do not delete a newer draft.
- Added the real Orders renderer: dynamic category rail with no `All`, global search shortcuts, compact direct +/- product cards, optional images/fallbacks, Quick Info, modifier/combo customizer, separate item/order notes, Delivery-only customer fields, zone/manual fee, exact discount/payment forms, Cash received/change, smart tenders, split payment, desktop persistent cart, and mobile cart sheet.
- Added local source validation and draft save serialization in the renderer; React dispatches typed domain/application operations rather than owning money/inventory business rules.
- Added `@tux/printing`, a pure immutable receipt renderer with HTML escaping and exact-money rendering.
- Added post-commit receipt printing through an application `OrderPrinter` port. Desktop uses a sandboxed Electron-main receipt window and `webContents.print()`; browser fallback uses the same receipt document through an isolated iframe/browser print dialog.
- Print failure does not roll back the placed order. Retry/Reprint works by immutable `OrderId` and creates no order/inventory/audit/outbox side effects. Idempotent checkout recovery never auto-prints a possible duplicate receipt and instead reports unknown print status.
- Added strict preload validation and narrow reprint IPC; the renderer never receives a native printer or raw IPC/SQLite capability.
- Added tests for exact decimal money input, payment logic, phone normalization, pricing, tenders, direct draft operations, SQLite checkout/rollback/idempotency/customer behavior, print-once/replay/failure/reprint behavior, and receipt escaping/rendering.
- Permanent CI on code head `b36081c017948aefb7122bca2c490ddca9671ca4` passed locked install, Prettier, ESLint, strict TypeScript, all unit/integration tests, browser production build, and Electron main/preload production builds before documentation synchronization.
- No remote Supabase project was linked or mutated; Phase 4 remains fully local-first with remote outbox delivery deferred to the later sync phase.
- Orders Board lifecycle actions, Cancel/Returned Delivery workflow, End Day draft resolution, Expenses, and Bulk Stock remain outside this Orders phase and are not claimed complete here.

## 2026-08-18 — Phase 5 Orders Board implementation

- Added the current-Business-Day Orders Board read model and worker-facing renderer.
- Implemented the approved lifecycle only: `ACTIVE → DONE`, `ACTIVE → CANCELLED`, and `DONE Delivery → RETURNED`.
- Added a time-bounded Done Undo; there is no general Reopen action.
- Active queue is oldest-first with waiting age and rich preparation cards; history views are newest-first compact rows.
- Search is deliberately limited to Order # across the current Business Day.
- Details drawer exposes immutable order/payment/delivery facts, receipt preview/reprint, and state-specific actions.
- Cancellation records the required prepared/restock decision. If food was not prepared, original `ORDER_CONSUMPTION` movements receive explicit compensating `CANCEL_RESTOCK` movements; prepared food is never restocked.
- Delivery Failed is Delivery-only from DONE, preserves the historical order total, creates no inventory restoration, records zero recognized revenue/collection semantics in audit/outbox, and creates the locked `DELIVERY_FAILED` expense record with `amount = null`.
- Every operational transition is one local transaction with order status/lifecycle metadata, audit, outbox, and any required inventory/expense side effect committed atomically.
- Electron renderer receives typed Orders Board IPC only; no raw SQLite/Node access was introduced.

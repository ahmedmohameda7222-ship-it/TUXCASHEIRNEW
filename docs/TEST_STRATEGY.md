# TUX V2 Test Strategy

## Principle

Tests protect operational invariants and architecture boundaries, not test-count metrics.

## Permanent CI gates

Every feature/PR validation runs from the committed npm lockfile:

1. formatting check;
2. ESLint;
3. strict TypeScript source typecheck;
4. Vitest unit/integration tests;
5. Operations browser production build;
6. Electron main/preload production build.

Electron typechecking and runtime bundling are intentionally separate: source is checked with TypeScript bundler resolution, then Vite produces the CommonJS main/preload artifacts Electron executes.

## Foundation coverage

Phase 1 protects Result/error primitives, runtime configuration parsing, Electron security preferences, and rejection of non-approved Electron development origins.

## Phase 2 domain/persistence coverage

Phase 2 tests protect:

- safe-integer exact Money arithmetic;
- exact fixed-point stock quantities;
- Business Day order allocation independent from midnight;
- Business Day close identity across midnight;
- executable SQLite initialization/migrations;
- transaction rollback on injected failure;
- one OPEN Business Day per shop;
- configuration and pending outbox recovery after SQLite restart.

## Phase 3 Business Day/operator coverage

Phase 3 adds focused coverage for:

- invalid PIN creates no Business Day;
- first valid PIN creates the open Business Day and operator session;
- session state recovers from durable local storage;
- a second worker signs into the same Business Day rather than creating a replacement day;
- worker switch preserves the Business Day ID;
- sign-out ends the current worker session but leaves the Business Day OPEN;
- SQLite migration v2 rejects a second simultaneous open worker session for the same Business Day;
- time-aware greeting salutation boundaries;
- malformed greeting hours reject rather than guess;
- desktop PBKDF2 verifier accepts the matching PIN and rejects mismatches/malformed or weak hashes;
- Electron preload accepts only structurally valid session results and known application errors.

The renderer explicitly uses a 1,250 ms greeting transition, within the approved 1–1.5 second range. A browser/Electron end-to-end assertion for the visual timing remains final E2E work rather than being simulated by a unit test.

Browser fallback is typechecked against the same application/persistence contracts and uses WebCrypto PBKDF2 plus IndexedDB. Phase 3 does not claim cross-tab IndexedDB enforcement equivalent to the SQLite open-worker-session unique index.

## Phase 4 Orders coverage

Phase 4 adds focused domain, persistence, application and receipt tests for the highest-risk checkout invariants.

### Exact money, payment and tender

Automated tests protect:

- exact decimal-string to `MoneyMinor` parsing without `parseFloat` or binary floating-point accounting;
- malformed/over-precision/unsafe money input rejection;
- discount and Delivery-fee pricing semantics;
- stable payment `logicType` behavior independent from display label;
- Cash Received minimum and exact Change;
- two-way split with Method B as exact remainder and duplicate-method rejection;
- smart Cash tender suggestions from common Egyptian denominations.

### Phone and Delivery identity

Automated tests protect Egyptian phone normalization across supported input forms and reject invalid identities.

SQLite Orders integration verifies that a successful Delivery checkout:

- persists normalized phone identity;
- snapshots configured and final Delivery fees separately;
- learns/updates the customer contact only after the local Order transaction succeeds.

### Draft operations

Domain tests protect:

- identical non-combo additions merging without losing total quantity;
- deterministic decrement of the most-recent product configuration;
- Sold Out products rejecting new draft units;
- exactly one allowed available beverage per combo unit;
- configured modifier eligibility/max quantity;
- Delivery-zone selection snapshotting configured and initial final fee.

The renderer consumes these domain operations rather than reimplementing them in JSX.

### Local checkout transaction

SQLite integration tests protect:

- validation failure creates no Order, inventory movement, audit, outbox, or display-number mutation and preserves the durable draft;
- successful Cash checkout writes exact payment snapshot, exact recipe inventory consumption, audit, outbox and Business-Day display allocation exactly once;
- injected inventory persistence failure rolls the complete checkout transaction back and preserves the durable checkout intent;
- checkout succeeds without a positive preloaded inventory balance, proving calculated shortage alone does not block sellability;
- successful checkout rotates the draft, resets payment, and restores the first active order type.

### Idempotency and restart-style recovery

SQLite integration verifies that replaying a stale already-committed checkout intent:

- returns the same immutable Order;
- does not create a duplicate Order;
- does not repeat inventory or outbox effects;
- does not advance the Business-Day display counter again;
- does not delete/replace a newer draft that already advanced.

### Receipt and printing semantics

Receipt tests protect:

- exact minor-unit rendering;
- immutable operator/order/payment snapshot projection;
- HTML escaping of order-controlled text.

SQLite/application integration with an injected recording printer protects:

- a fresh durable checkout invokes printing once only after commit;
- idempotent replay never automatically prints a second possible receipt and reports unknown print status;
- print failure leaves the Order/inventory/outbox durable;
- failed and later successful `reprintOrder()` calls read the same immutable Order;
- reprint does not create new Order, inventory, audit, outbox, or numbering effects.

Electron/browser printer adapters, preload IPC validation and the React renderer are covered by strict typechecking and production builds. Manual or dedicated browser/Electron interaction E2E is still required before renderer-only compliance rows are promoted from `IMPLEMENTED_NOT_VALIDATED` to `PASS`.

## Phase 5 Orders Board coverage

Phase 5 adds pure-domain lifecycle tests plus seven SQLite/application integration scenarios for the correction paths most likely to corrupt historical or reconciliation facts.

Automated tests protect:

- the approved state machine (`ACTIVE → DONE`, `ACTIVE → CANCELLED`, `DONE Delivery → RETURNED`) and invalid-transition rejection;
- an eight-second authoritative Done Undo boundary, including rejection after 8.001 seconds without an extra mutation;
- Board loading from the currently open Business Day only, even when historical orders exist on another calendar/closed day;
- Mark Done/Undo creating audit/outbox revisions without changing payments or inventory;
- not-prepared cancellation creating an exact positive `CANCEL_RESTOCK` linked to the original negative `ORDER_CONSUMPTION` movement while preserving order financial facts;
- prepared cancellation creating no restock;
- Delivery Failed preserving the historical order/payment snapshot, creating no stock restoration, inserting exactly one linked `DELIVERY_FAILED` Expense with null amount/payer, and writing audit/outbox return facts;
- terminal/invalid corrections creating no audit, outbox, expense, or inventory side effects.

Strict TypeScript and production builds cover the browser/Electron typed Board clients, IPC validation and React renderer wiring. Sorting, responsive card/row layout, search interaction, details drawer, modal decisions, waiting-age display and the visible Undo toast remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron interaction QA or dedicated E2E evidence exists.

## Phase 6 Expenses coverage

Phase 6 adds domain and SQLite integration coverage for the current-Business-Day operational ledger.

Automated tests protect:

- manual Description/Amount/Paid From/optional Note validation using exact minor units;
- legacy manual rows upgrading to revision-zero lifecycle metadata;
- exact Total Expenses across Cash + Other and a separate exact Cash-only subtotal for later Expected Cash;
- current open Business Day isolation and newest-first ledger ordering independent of calendar date;
- edit preserving Expense identity/original creation time while incrementing revision and changing totals correctly;
- audited soft-delete removing a manual row from current ledger/totals while preserving its database payload;
- Delivery Failed remaining visible, locked and excluded from both financial totals;
- historical Business Day mutation rejection without audit/outbox side effects;
- atomic rollback when outbox persistence fails after expense/audit work has begun.

Strict TypeScript and production builds cover the typed browser/Electron Expenses client, preload validation, dedicated native IPC boundary and renderer wiring. Add/Edit/Delete dialog interaction, responsive ledger presentation, visible Total Expenses, and newest-first rendered ordering remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron QA or dedicated E2E evidence exists.

## Migration validation

SQLite migrations are executed by automated persistence/session tests.

The remote Postgres/Supabase migration chain is reviewed and versioned in Git but remains unapplied because no authorized V2 Supabase project/local stack is connected. The first real target setup must validate the complete chain before remote application connectivity is enabled.

## Remaining high-risk coverage

As the corresponding later phases land, tests must prioritize:

- Bulk Stock compensating movements;
- blind reconciliation;
- offline End Day close;
- restart/outbox retry;
- renderer interaction/responsive/accessibility E2E across Orders and later screens.

Phase 10 owns the complete approved end-to-end scenario and final responsive/accessibility audit.

## Phase 7 Bulk Stock coverage

Automated Phase 7 coverage protects:

- exact positive whole-unit `Add Stock` validation;
- exact one-whole-unit `Finished 1` decrement;
- current balance derived from movements across a closed and current Business Day;
- exposure of active `BULK_MANUAL` items only;
- stable command UUID replay producing no duplicate movement;
- short Undo as an exact compensating movement with the original history preserved;
- duplicate and expired Undo rejection;
- `Add Stock` creating no Expense/Purchase financial mutation;
- atomic rollback when durable outbox persistence is forced to fail after the movement command begins;
- typed browser/IndexedDB and Electron/SQLite capability wiring through strict TypeScript and production builds.

Rendered card layout, Add Stock dialog interaction, direct `Finished 1`, visible short Undo and responsive behavior remain `IMPLEMENTED_NOT_VALIDATED` until rendered browser/Electron QA or dedicated E2E evidence exists.

## Phase 8 End Day coverage

Automated Phase 8 coverage protects:

- Cash-first reconciliation ordering with current Cash/Digital methods and no Card reconciliation path;
- ACTIVE orders hard-blocking End Day before reconciliation mutation;
- meaningful durable drafts remaining intact until explicit discard;
- READY gate returning payment method identity only, with no Expected-value leakage;
- DONE-only recognized sales/payment collection, with Cancelled and Returned Delivery excluded;
- exact Cash expectation after Cash-paid Expenses;
- exact signed variance and mandatory reason for non-zero difference;
- successful close with a non-zero variance reason and no automatic variance Expense;
- cross-midnight Business Day close, current Worker Session end, reconciliation/audit/outbox persistence;
- Bulk Stock movement history remaining unchanged by End Day;
- replaying close on an already-closed Business Day producing no duplicate reconciliation/close outbox;
- injected outbox persistence failure rolling back reconciliation, session end, Business Day close and close audit;
- new Business Day display-order allocation beginning at #1.

Strict TypeScript and production builds validate browser/Electron End Day boundaries. Profile-menu interaction, blind-count presentation, Final Closing Summary rendering and post-close locked-screen transition remain `IMPLEMENTED_NOT_VALIDATED` until rendered QA/E2E evidence exists.

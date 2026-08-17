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

## Migration validation

SQLite migrations are executed by automated persistence/session tests.

The remote Postgres/Supabase migration chain is reviewed and versioned in Git but remains unapplied because no authorized V2 Supabase project/local stack is connected. The first real target setup must validate the complete chain before remote application connectivity is enabled.

## Later high-risk coverage

As the corresponding phases land, tests must prioritize:

- checkout transaction rollback;
- order idempotency/double-click/restart;
- payment/split/tender calculations;
- Egyptian phone normalization/customer update timing;
- cancellation stock compensation;
- Returned Delivery zero-revenue/non-financial Expense semantics;
- Expenses Cash vs Other reconciliation effect;
- Bulk Stock compensating movements;
- blind reconciliation;
- offline End Day close;
- restart/outbox retry;
- printing failure after successful save.

Phase 10 owns the complete approved end-to-end scenario and responsive/accessibility audit.

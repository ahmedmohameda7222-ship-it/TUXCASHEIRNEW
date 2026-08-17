# TUX V2 Test Strategy

## Principle

Tests protect operational invariants and architecture boundaries, not test-count metrics.

## Permanent CI gates

Every feature/PR validation runs from the committed npm lockfile:

1. formatting check;
2. ESLint;
3. strict TypeScript source typecheck;
4. Vitest unit/integration tests;
5. Operations production build;
6. Electron main/preload TypeScript build.

## Foundation coverage

Phase 1 protects:

- Result/error primitives;
- runtime configuration parsing;
- Electron security preferences;
- rejection of non-approved Electron development origins.

Static assertions against placeholder React copy are intentionally omitted.

## Phase 2 domain coverage

Phase 2 tests protect the foundational rules that later commands will depend on:

- Money accepts only safe integer minor units and performs exact arithmetic;
- stock quantities use exact fixed-point micro-units;
- Business Day order allocation starts at 1 and is independent from midnight;
- Business Day can close after midnight without changing identity;
- SQLite migration initialization is executable;
- injected SQLite transaction failure rolls back all writes;
- the database rejects a second OPEN Business Day for the same shop;
- configuration and pending outbox data survive closing/reopening the SQLite file.

Phase 2 also typechecks the browser IndexedDB adapter against the same repository contract. Browser behavior receives workflow/E2E coverage once the browser runtime is wired to real application commands.

## Migration validation

SQLite migrations are executed by the automated persistence tests.

The remote Postgres/Supabase migration is reviewed and versioned in Git but is not claimed engine-applied in Phase 2 because no authorized V2 Supabase project/local stack is connected. The first real target setup must validate the complete migration chain before remote app connectivity is enabled.

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

The final Phase 10 run owns the complete approved end-to-end scenario and responsive/accessibility audit.

# TUX V2 Test Strategy

## Principle

Tests protect operational invariants and architecture boundaries, not test-count metrics.

## Phase 1 gates

Every pull request into `integration/tux-operations-v2` runs, from the committed npm lockfile:

1. formatting check;
2. ESLint;
3. strict TypeScript source typecheck;
4. Vitest unit tests;
5. Operations production build;
6. Electron main/preload TypeScript build.

Phase 1 unit coverage is intentionally small because feature-domain behavior has not been implemented yet. It validates:

- the shared Result primitive;
- runtime configuration parsing;
- Electron window security preferences;
- rejection of non-approved Electron development origins.

The production Electron wiring is also reviewed structurally for narrow preload exposure, main-frame IPC sender validation, navigation/new-window denial, and renderer CSP. Third-party declaration conflicts may use project-level `skipLibCheck`; this does not disable strict checking of TUX source.

## Later high-risk coverage

As the corresponding phases land, tests must prioritize:

- exact Money arithmetic;
- Business Day identity and midnight crossing;
- display order allocation;
- checkout transaction rollback;
- idempotency/retry;
- payment/split/tender calculations;
- cancellation stock compensation;
- Returned Delivery financial semantics;
- Expenses Cash vs Other;
- Bulk Stock compensating movements;
- blind reconciliation;
- offline End Day close;
- restart/outbox recovery.

The final Phase 10 run owns the full approved end-to-end scenario and responsive/accessibility audit.

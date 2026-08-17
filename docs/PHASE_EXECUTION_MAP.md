# TUX Operations V2 — Phase Execution Map

This is the concise execution map for the approved build sequence. The canonical product behavior remains the Master Plan; this file tracks engineering progression only.

| Phase | Branch | Scope | Initial gap | Status |
|---|---|---|---|---|
| 0 | `feat/ops-00-bootstrap` | Repository governance, canonical spec, compliance/log docs | Empty repository / no Git history | IN_PROGRESS |
| 1 | `feat/ops-01-foundation` | TypeScript monorepo, React, Electron shell, CI, tokens, test harness | Not built | NOT_STARTED |
| 2 | `feat/ops-02-domain-persistence` | Domain, Money, local DB, browser persistence, outbox, SQL migrations | Not built | NOT_STARTED |
| 3 | `feat/ops-03-business-day-operator` | Locked screen, PIN abstraction, Business Day, operator, greeting | Not built | NOT_STARTED |
| 4 | `feat/ops-04-orders` | Full Orders / checkout contract | Not built | NOT_STARTED |
| 5 | `feat/ops-05-orders-board` | Approved order lifecycle and operational board | Not built | NOT_STARTED |
| 6 | `feat/ops-06-expenses` | Current Business Day expense ledger | Not built | NOT_STARTED |
| 7 | `feat/ops-07-bulk-stock` | Whole-unit Bulk Stock movement ledger | Not built | NOT_STARTED |
| 8 | `feat/ops-08-end-day-reconciliation` | Blind reconciliation and durable End Day close | Not built | NOT_STARTED |
| 9 | `feat/ops-09-printing-sync-hardening` | Printing, sync worker, observability, recovery hardening | Not built | NOT_STARTED |
| 10 | `feat/ops-10-final-compliance-qa` | Literal spec audit, full E2E, release readiness | Not built | NOT_STARTED |

## Repository observations

- `TUXCASHEIRNEW` was confirmed empty before Phase 0.
- One minimal bootstrap commit on `main` is allowed by the execution prompt.
- All product implementation must target `integration/tux-operations-v2` through phase branches.
- Legacy `Tuxcashier` is read-only reference. Its large `src/AppCore.js` monolith is specifically not a V2 architecture template.
- No remote Supabase project is configured or required now; remote migration application is forbidden until explicitly authorized.

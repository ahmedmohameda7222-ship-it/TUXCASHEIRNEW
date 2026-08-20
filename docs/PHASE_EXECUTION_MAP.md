# TUX Operations V2 — Phase Execution Map

This is the concise execution map for the approved build sequence. The canonical product behavior remains the Master Plan; this file tracks engineering progression only.

| Phase | Branch | Scope | Initial gap | Status |
|---|---|---|---|---|
| 0 | `feat/ops-00-bootstrap` | Repository governance, canonical spec, compliance/log docs | Empty repository / no Git history | PASS |
| 1 | `feat/ops-01-foundation` | TypeScript monorepo, React, Electron shell, CI, tokens, test harness | Not built | PASS |
| 2 | `feat/ops-02-domain-persistence` | Domain, Money, local DB, browser persistence, outbox, SQL migrations | Not built | PASS |
| 3 | `feat/ops-03-business-day-operator` | Locked screen, PIN abstraction, Business Day, operator, greeting | Not built | PASS |
| 4 | `feat/ops-04-orders` | Full Orders / checkout contract | Not built | NOT_STARTED |
| 5 | `feat/ops-05-orders-board` | Approved order lifecycle and operational board | Not built | NOT_STARTED |
| 6 | `feat/ops-06-expenses` | Current Business Day expense ledger | Not built | NOT_STARTED |
| 7 | `feat/ops-07-bulk-stock` | Whole-unit Bulk Stock movement ledger | Not built | NOT_STARTED |
| 8 | `feat/ops-08-end-day-reconciliation` | Blind reconciliation and durable End Day close | Not built | NOT_STARTED |
| 9 | `feat/ops-09-printing-sync-hardening` | Printing, sync worker, observability, recovery hardening | Not built | NOT_STARTED |
| 10 | `feat/ops-10-final-compliance-qa` | Literal spec audit, full E2E, release readiness | Not built | NOT_STARTED |

## Repository observations

- `TUXCASHEIRNEW` was confirmed empty before Phase 0.
- One minimal bootstrap commit on `main` is allowed by the execution prompt; product implementation remains isolated from `main`.
- All product implementation targets `integration/tux-operations-v2` through phase branches.
- Legacy `Tuxcashier` is read-only reference. Its large `src/AppCore.js` monolith is specifically not a V2 architecture template.
- No remote Supabase project is configured; remote migration application remains forbidden until explicitly authorized.
- Phase 1 established the strict TypeScript workspace, shared React renderer, secure Electron boundary, design tokens, runtime-config validation, lockfile, tests, and permanent CI quality gate.
- Phase 2 established the domain/local-first persistence foundation and was squash-merged through PR #4 into integration as `10f15a057f5371987a4e2f7fb119fedfdd901a9d`.
- Phase 3 implements Business Day/operator behavior, narrow PIN/session runtime adapters, worker-session persistence, greeting transition, and SQLite worker-session uniqueness. Permanent CI run `32068544454` passed install, format, lint, strict typecheck, unit/integration tests, browser build, and Electron main/preload builds on the PR documentation head.
- Phase 3 PASS does not mean START-001 is visually complete: the approved graphic TUX logo asset is still absent, so the locked screen uses a typographic fallback and that atomic visual requirement remains a known gap for final compliance.

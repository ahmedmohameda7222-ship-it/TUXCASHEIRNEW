# TUX Operations V2

Production-oriented TypeScript implementation of **TUX Operations** for local-first counter-service/POS use. The current repository state is Operations-only: Orders, Orders Board, Expenses, Bulk Stock, Business Day/operator flow, End Day/reconciliation, printing, local persistence, automatic outbox sync contracts, and secure Electron/browser runtimes are implemented. **TUX Admin remains a future separate application.**

The authoritative repository is `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`. The legacy `ahmedmohameda7222-ship-it/Tuxcashier` repository is read-only reference only.

## Architecture

- `apps/operations` — shared React Operations renderer and browser fallback.
- `apps/operations-desktop` — secure Electron main/preload runtime backed by local SQLite.
- `packages/domain` — exact business/domain types, parsing and invariants.
- `packages/application` — coordinated local-first business commands, draft recovery, End Day, inbound configuration boundary and printer configuration contract.
- `packages/persistence` — SQLite and versioned IndexedDB adapters plus durable drafts/outbox.
- `packages/sync` — automatic outbox delivery, deep runtime contracts, dependency/quarantine policy and monotonic remote materialization rules.
- `packages/printing` — immutable receipt rendering.
- `supabase/migrations` — unapplied PostgreSQL/Supabase-compatible schema migrations for the later backend connection phase.
- `e2e` — permanent Playwright rendered Operations regression coverage using realistic development data.

No remote Supabase project is connected by this repository state. Repository migrations are smoke-tested only against ephemeral local PostgreSQL in CI.

## Required validation

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:migrations   # requires loopback TEST_DATABASE_URL + psql
npm run test:e2e          # installs/runs against a local Chromium runtime
npm run package:win       # unsigned Windows x64 NSIS package target
```

GitHub Actions runs the complete quality/migration/rendered gate on `main` PRs and pushes and independently validates the unsigned Windows x64 package. See `docs/REPOSITORY_GOVERNANCE.md` for the required external branch-protection setting and `docs/TEST_STRATEGY.md` for evidence boundaries.

## Development provisioning

A development-only local provisioning command creates a demo shop, securely hashed test workers, realistic menu/configuration data and local inventory through the same validated atomic configuration path intended for future backend provisioning:

```bash
npm run dev:provision -- --database .tmp/tux-dev.sqlite3 --pin 2468 --secondary-pin 1357
```

The command refuses to run when `NODE_ENV=production`. Test PINs are hashed before persistence and are not production credentials.

## Desktop packaging and printing

`electron-builder.yml` defines the unsigned Windows x64 NSIS development/package target. Production code signing is deliberately not claimed without a release signing certificate. Receipt printing remains post-commit and non-destructive; printer configuration supports an optional selected device with explicit fallback-to-default behavior.

## Product and deployment boundaries

- No TUX Admin application or Admin tab exists in Operations.
- No remote Supabase project, credentials or migrations are connected/applied.
- No production secrets or plaintext production worker PINs belong in the repository.
- The unresolved Delivery-after-End-Day product contradiction is documented without changing approved DONE/RETURNED/End Day semantics.
- The approved graphic TUX logo asset is still an external product asset blocker if it has not been supplied.

## Canonical specification

`docs/TUX_V2_Operations_Master_Approved_Plan.md` is the binding Operations product contract. Stabilization decisions and current evidence are recorded in `docs/IMPLEMENTATION_LOG.md` and `docs/OPERATIONS_COMPLIANCE_MATRIX.md`.

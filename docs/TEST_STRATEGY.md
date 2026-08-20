# TUX V2 Operations Test Strategy

## Permanent required gates

The repository quality workflow runs on pull requests targeting `main` and pushes to `main`. It exposes one stable aggregate check named **Required quality gate** and requires:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:migrations
npm run test:e2e
Windows: npm run package:win
```

No required step is allowed to fail-soft, skip a package or weaken compiler/linter rules.

## Domain and application tests

Vitest covers exact Money/quantity arithmetic, Business Day identity/numbering, payment/tender logic, lifecycle transitions, Expenses, inventory, End Day projections, deep sync envelope parsing, monotonic receiver rules, printer configuration and inbound configuration validation.

## SQLite integration

SQLite tests exercise real transactions and restart semantics, including:

- checkout atomicity and idempotency;
- deliberately delayed printer proving another command proceeds after Order commit while printing remains pending;
- crash-before-draft-reset recovery with one Order/inventory/audit/outbox effect;
- Board Done/Undo/Cancel/Delivery Failed;
- Expense revision/idempotency;
- Bulk Stock append-only movement/undo;
- End Day blocking, reconciliation, variance and close rollback/idempotency;
- outbox permanent-origin/dependent blocking across restart while unrelated aggregates continue;
- atomic configuration replacement and last-known-good preservation.

## IndexedDB migration test

`fake-indexeddb` is used only in tests. The migration suite creates production v1 stores, inserts representative business data, upgrades through the v2 migration registry and asserts both record preservation and new indexes. Fresh-install creation is also verified.

## Deep network-contract tests

Malformed nested sync payloads fail before a remote mutation plan exists. Cases include invalid item UUID, bad payment logic type, invalid lifecycle revision, malformed timestamp, negative/unsafe money, wrong modifier quantity type, mismatched shop identity and malformed inventory movement.

## Postgres migration smoke

CI uses ephemeral PostgreSQL 16 and `scripts/test-migrations.mjs`. The chain starts from an empty application schema and validates representative composite tenant FKs, lifecycle checks, indexes, sync receipt table and RLS enablement. No remote Supabase project is touched.

## Stable rendered Operations QA

`playwright.config.ts` and `e2e/operations.e2e.ts` live permanently in the repository. Playwright uses Chromium against the production-built renderer, with desktop (1440×960) and mobile browser fallback (390×844) projects.

The test fixture is development/test-only and seeds a realistic 18-product catalog with multiple categories, long/short names, sold-out item, modifiers, required-beverage combo, Delivery zones, Cash, Instapay and Bulk Stock inventory. It does not alter production code or define production prices.

Rendered workflow coverage includes no active Business Day, PIN start, Orders, modifiers/combo, Delivery fields, Cash, Instapay, split payment, Orders Board, Cancel, Delivery Failed, Expenses, Bulk Stock and End Day/post-close state. Console errors, page errors and horizontal overflow are guarded.

Local container policy may block loopback Chromium navigation; the authoritative rendered gate therefore runs on the permanent GitHub Actions Ubuntu runner with Playwright-managed Chromium.

## Windows packaging smoke

A Windows GitHub Actions runner performs `npm ci` and `npm run package:win` with code-signing auto-discovery disabled, then uploads the unsigned x64 NSIS artifact. Production signing is not claimed without an external certificate/release credential.

## Security checks

Tests/source validation preserve renderer sandbox/context isolation, disable Node integration, validate IPC sender/frame, prohibit insecure non-loopback sync HTTP, keep PINs hashed and keep RLS deny-by-default until the reviewed auth phase.

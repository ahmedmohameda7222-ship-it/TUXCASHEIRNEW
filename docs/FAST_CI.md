# TUX fast CI (October 23, 2026)

## Pull requests: focused and parallel
- `TUX V2 CI` uses changed-path classification, followed by independent parallel jobs with `timeout-minutes: 3`. A 3-minute timeout caps runner time, not queue time, and cannot guarantee passing.
- Fast jobs: changed-file Prettier/ESLint, Vitest related tests, affected TypeScript workspaces and E2E types, security contracts when applicable, PostgreSQL migrations only for schema changes, and changed Deno functions.
- Docs-only PRs run the selector and final required gate. Changed files that affect behavior must never silently produce no checks.
- Changes to `packages/*`, shared contracts, or npm lockfiles trigger broader typechecking. Changes to Orders/Sync/Authentication must run their related regression tests. If a check exceeds three minutes, shard it or narrow it with equivalent coverage; **do not silently suppress failures**.
- The required-quality-gate job fails for any executed check that fails or is cancelled, and accepts intentionally skipped checks.

## Full regression
- `TUX Full Regression (Manual)` is intentionally separate from the PR gate; it includes broad E2E, schema, Edge, and Windows packaging. Run it on demand before releases and for high-risk migrations or changes to authorization/financial logic.
- Historical P01–P10 workflows were removed; their behavior-focused test files remain available (and history is in git).
- The pre-merge screenshot matrices in `artifacts/` have been removed from the tree; they were **mocked test evidence, not production images**. Removed the P08–P10 184-image capture-only test harness and image-integrity script. Product/brand images under `apps/*` are untouched.
- New visual evidence is no longer generated on every PR. Playwright retains screenshots/traces only on failure when the manual full regression is run.
- Never deploy from CI checks; no production database data should be touched by testing.

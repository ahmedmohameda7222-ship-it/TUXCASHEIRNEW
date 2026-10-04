# TUX Admin Plan 6 — final-review hardening checkpoint — 2026-10-03

This checkpoint supplements `2026-09-10-tux-admin-execution.md` with the exact-head findings closed after the 2026-09-28 Plan 6 preflight. It does not start Plan 7, perform a production deployment, or merge PR #99.

## Scope and ancestry

- PR: #99 — `feat(admin): Plan 6 workforce`
- Branch: `feat/admin-06-workforce`
- Base / merge base: `46b15bc19b1120289199497e6579b631cf749029`
- Reviewed code head before this documentation-only commit: `0324d28cb70c02f3a2618aedd02621f44237f1e7`
- PR remained draft, mergeable and unmerged at the reviewed code head.
- No unresolved inline review threads were present.
- No Plan 7 files or temporary formatter workflow artifacts were present in the PR diff.

## Findings closed after the earlier preflight

- Employee PIN uniqueness is now tenant-scoped instead of globally coupling unrelated businesses. `20261003101600_admin_workforce_pin_business_unique.sql` replaces the active employee PIN lookup unique index with `(business_id, pin_lookup_hash)` while Operations worker PIN uniqueness remains shop-scoped.
- PIN staging idempotency is tenant-scoped. `20261003101800_admin_workforce_pin_command_tenant_scope.sql` replaces the global private PIN-command UUID uniqueness with `(business_id, command_id)` and scopes replay lookup to the owning business.
- Workforce PIN tenant-isolation PostgreSQL regression covers both reuse of the same numeric PIN in unrelated businesses and reuse of the same client command UUID in unrelated businesses.
- Staff approval replay lifecycle is terminal-aware: `REJECTED` and `FAILED` return terminal errors and `EXECUTED` returns applied success instead of remaining indefinitely `PENDING_APPROVAL`.
- Employee PIN UI idempotency is memory-only and terminal-aware. The same PIN command ID is retained only across pending approval or network ambiguity; authoritative terminal success/failure rotates the in-memory ID. Raw PIN/verifier/lookup/salt material is not persisted in localStorage.
- Cross-plan Orders approval lifecycle hardening is durable at the source of truth. `20261003101700_admin_order_approval_terminal_receipts.sql` atomically converges both the order command receipt and the refund/return row to `REJECTED` or `FAILED`, includes a repair pass for pre-existing terminal approvals, and never downgrades an already `POSTED` business effect.
- `AdminOrderFinancialEvent.state` now represents `PENDING_APPROVAL | POSTED | REJECTED | FAILED`, so Order detail can display terminal financial-correction truth instead of stale pending state.
- The permanent Plan 6 PostgreSQL gate runs `test-admin-workforce-order-approval-terminal-replay-postgres.mjs`, proving rejected refund/return replay and terminal execution failure converge durably and no longer replay stale pending receipts.

## Exact reviewed-code gate evidence

At exact code head `0324d28cb70c02f3a2618aedd02621f44237f1e7`:

- `Admin Plan 6 Workforce TDD` run `37117406526` (#430): **SUCCESS**. All permanent jobs passed, including finance-core static/PostgreSQL, Workforce static/PostgreSQL, tenant-isolation and cross-plan approval regressions, employee PIN security, services/API typecheck, calculations, UI/typecheck, Admin-rendered Workforce E2E, and final full migration/unit/typecheck regression.
- Root `TUX V2 CI` run `37117406559` (#5632): **SUCCESS**. Format, lint, unit/integration, Admin security, repository typecheck, production builds, migration-chain smoke, Supabase function-auth deployment contract, Edge Function typecheck, rendered browser E2E, Admin/Menu jobs, packaging, architecture gates, and the required quality gate all passed.
- Compatibility workflows on the same code head all completed **SUCCESS**: Foundation `37117406479`; Catalog Settings `37117406503`; Catalog Boundary `37117406433`; Plan 2 rounds 15/16/17 `37117406491` / `37117406555` / `37117406482`; Plan 3 `37117406495`; Plan 4 `37117406570`; Plan 5 `37117406403`.

## Supabase / deployment boundary

The canonical project remains `awpdcsayuwbsruwvaosg` (`TUX V2`, eu-central-1). The earlier promoted finance/workforce runtime migrations remain `20260927084404 admin_finance_core` and `20260927161740 admin_workforce` as recorded in the main execution ledger.

The post-preflight forward hardening migrations listed above are repository changes under review; this checkpoint does **not** claim they were production-applied. No Vercel production deployment was performed, PR #99 was not merged, and no Plan 7 implementation was started.

Because this documentation-only checkpoint changes the PR head, final readiness must use the workflow results for the new ledger-inclusive exact head, not the pre-documentation code head above.

# TUX Admin Plans 1–7 — PR #119 continuation evidence ledger

Last inspected: 2026-10-12 (GitHub and read-only canonical Supabase checks).
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`.
Existing Draft PR: [#119](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/pull/119), branch `fix/admin-plans1-7-functional-completeness`.
Recovery HEAD: `cb167f8c879e0ffb15b5f56385c88710450e8e65`, base: `4a06171cfdebd042debd90d70a3fdb0de1a4d518`.
Canonical Supabase: `awpdcsayuwbsruwvaosg` only.
This is a continuation record; earlier implementation history is not reconstructed here.

## Live facts

- PR #119 was OPEN, DRAFT, UNMERGED; recovery compare was 284 commits ahead / 0 behind, 130 files changed.
- All thirteen PR-triggered domain/root workflows succeeded at recovery HEAD `cb167f8`; **this is not evidence of new-head success**.
- The 21 October 11 correction migrations, `20261011032824` through `20261011224711`, are recorded in canonical `supabase_migrations.schema_migrations`. No correction migration was replayed in this continuation.
- Read-only snapshot: 49 products, 8 inventory items, 0 recipe lines, 0 unit conversions, 3 purchase orders / 5 lines, 13 POS orders, 5 online order requests, 1 shop, 1 inactive `inventory.adjust` approval rule and 12 payments with non-null `refund_allowed_snapshot`.
- `upsert_admin_approval_rule_v1`, `apply_admin_shop_settings_copy_v1`, `create_catalog_draft_v1`, and `publish_catalog_draft_v1` are SECURITY DEFINER and currently grant EXECUTE to `service_role` but neither `anon` nor `authenticated`; broader security audit remains open.
- No submitted PR reviews/review threads were returned at inspection. No real authenticated Admin-browser integration acceptance was performed; production test business writes are prohibited.

## Task / acceptance ledger

| Requirement | Authority | Starting state / code evidence | Continuation change / evidence | Tests and migration impact | Status / remaining risk |
| --- | --- | --- | --- | --- | --- |
| Selective cross-shop catalog copy | Approved design §5 and Plan 2 shop/catalog control | `ShopCopyPreviewPanel.tsx` and `shopCopyPreviewRoute.ts` support checkout/receipts only. `private.validate_admin_catalog_bundle_v1` and `publish_catalog_draft_v1` require shop-scoped identities. | No unsafe bundle-copy command added. Multi-shop collision/dependency mapping, atomic draft creation and provenance are still required. | No new migration; one real shop prevents production multi-shop acceptance. | **BLOCKED**: trusted transactional identity mapping + authorized migration/safe fixtures needed; settings copying preserved. |
| First Operations worker on a new shop | Approved design §15, Plan 6 and workforce hardening | `EmployeeDetailPage.tsx` links only existing unlinked active workers. `api/worker-auth.ts` authenticates existing worker; not a provisioning API. | Confirmed gap remains; no new credentials/identities created. | No DB writes; first-worker-to-real-login integration unverified. | **BLOCKED**: approved worker provisioning authority or verified Operations setup link needed. |
| Approval Rule action semantics | Approved design §8.4, Plan 3 | Arbitrary action text could produce never-evaluated rules; real actions wired through `orderApproval.ts`, `staffApproval.ts`, order command RPCs. | Added server action/threshold allowlist, controlled client selector, legacy no-op protection, tests in `approvalRulesManagement.test.ts` and `admin-approval-rules.spec.ts`. | No SQL migration; validation via *new exact-head CI required*. Mocked Playwright is UI-contract only. | **FIXED NOW — NOT YET EXACT-HEAD VERIFIED**; needs real approval request/decision/once-only execution in isolated environment. |
| Customer segments and targeting | Design §14.4, Plan 5 Task 4; Plan 9 richer profile | `crmService.ts` uses `computeAutomaticSegments`, UI is display-only; Plan 5 specifies eight automatic segments. | Reviewed only; no unsupported custom segment editor or Plan 9 CRM additions. | 6 customers and 9 `customer_segments` rows observed; targeting linkage and deterministic recalculation integration not proven. | **SOURCE PRESENT BUT UNVERIFIED**; Planner ruling needed for custom rule configuration/targeting beyond Plan 5 automatic segments. |
| Inventory, purchasing, orders, settings, payments, shop lifecycle | Plans 1–7 plus hardening | Source implementations previously committed to PR #119, including conversion/multi-line purchase draft, refund snapshot, settings copy and shop lifecycle. | Preserved already validated source; no duplicate migration or fabricated business record. | Previous recovery exact-head 13 workflows green. Safe real BFF/RPC/DB integration missing. | **SOURCE PRESENT BUT UNVERIFIED END-TO-END**. |
| Recipe-derived COGS and profit | Plan 4 / Plan 7 | Live production has zero recipe lines and unit conversions. | Did not write dummy Production recipes. | Disposable isolated completed-sale cost fixture not run. | **DATA READINESS** and integration acceptance still open; do not imply complete historical COGS accuracy. |
| Security / release compatibility | Cross-cutting hardening and Master Plan | Source-level boundaries and 21 applied migrations are already in place. | Checked 4 critical RPC EXECUTE grants read-only. | Full diff review, checksum/reconciled SQL signatures, Main/Menu/Operations compatibility, RLS advisor classification not complete. | **PARTIAL REVIEW**; do not certify release. |
| Master Plan exact-head tests / QA | Master Plan | 13 workflows green on recovery SHA, not automatically on new commits. | Test-first approval code commits triggered new workflows. | Inspect final exact SHA, all required jobs, mobile/desktop E2E, mocked vs integrated distinctions. | **IN PROGRESS**; report run IDs only after they conclude. |

## Continuation commits

- `01e3280185ca0ed0a778c433d4a9f8266ae1351e` — approval action/threshold RED regression cases.
- `8cf61c289064441ba2efa131488603c8f5444c26` — executable action registry.
- `c982b92712c33da2466001a74814925574feca29` — server-side action, permission and threshold validation.
- `6128c6855ecebadbec507e74da11408078cd5cf1` — controlled Approval Rules editor and legacy protection.
- `ad4c60817e653141ddab7aa644e161a7c06e4ae3` — Approval Rules mocked UI regression coverage.
- Subsequent ordinary style/test corrections through `3cfa7396f0f98f61944f184efbd525ad4806c631`; inspect GitHub commit history for complete exact SHAs.

## Operating guardrails

No merge, deployment, PR Ready-for-Review, new PR/branch, force-push, production-data mutation, cross-project database access, fake recipe, or SQL migration application was performed in this continuation. No Plan 8–10 scope implemented. Before Planner handoff, recapture actual PR HEAD, checks, review status and repository/DB migration parity; do not treat this ledger as completion evidence.

# TUX V2 — PR #119 Independent Planner Handoff (A–M)
**Prepared:** 2026-10-16 (Africa/Cairo)  
**Classification:** **CORRECTIONS STILL REQUIRED — NOT APPROVED FOR MERGE**  
**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Existing PR:** https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/pull/119  
**Branch:** `fix/admin-plans1-7-functional-completeness`  
**Inspected HEAD:** `ffd849fcd33367c99cd7a8cfa7e34faeb853dc6e` (821 commits on PR, 245 changed files). This report's addition creates a newer documentation-only HEAD: reverify CI for that actual HEAD.

## A. Executive determination
The Plans 1–7 correction program has substantial tested functionality, including finance, shop lifecycle, inventory, workforce and catalog-copy safeguards. The following **remaining approved gaps prevent acceptance**: optional sensitive Settings/payment/tax approval enforcement, trusted thresholded catalog-price publication approval, and end-to-end authenticated two-shop real-operation proof covering Menu/Operations/POS/ONLINE and recipe/COGS. Finance transfer thresholding requires independent Planner confirmation of the documented scope ruling, not an invented approval action. Existing clean CI cannot substitute for these tests.

## B. Immutable control-plane identities
- Main comparison baseline: `4a06171cfdebd042debd90d70a3fdb0de1a4d518` (PR metadata; do not reset).
- Canonical Supabase project: `awpdcsayuwbsruwvaosg`. 196 applied migrations; most recent `20261015231756_admin_shop_archive_lifecycle_approval`.
- No merge, release, replacement PR or production fixture creation was authorized/performed in this continuation.
- Approval rules whitelist currently contains 12 actually runner-connected action identities; do not falsely advertise absent settings/catalog rules.

## C. PR / independent review state
- PR OPEN, DRAFT and unmerged at inspected HEAD.
- 0 submitted GitHub reviews, 0 review threads (hence 0 unresolved).
- Independent Planner review remains necessary; absence of threads is not acceptance.

## D. Exact-HEAD CI snapshot
At `ffd849fcd33367c99cd7a8cfa7e34faeb853dc6e`: **8 successful, 5 in progress, 0 failed** across 13 permanent workflows when last inspected. Success: Plan 2 Round 15/16/17; Catalog Settings TDD; Catalog Settings Boundary TDD; Foundation; Plan 7 Finance; Plan 3 Approvals. In progress: Pre-Plan-7 UI/UX, Plan 6 Workforce, Plan 4 Inventory, Plan 5 Orders, TUX V2 CI. Never report 13/13 until a later single, immutable exact-head verification shows it. Relevant acceptance examples and targeted run evidence are in the continuation ledger.

## E. Plan 1 / admin foundation
Existing auth, principal scope, CSRF and admin boundary changes remain under Foundation CI. No newly discovered Plan 1 correction confirmed in Continuations VI/VII. Full authenticated deployment has not been exercised on this PR branch.

## F. Plan 2 / Settings and Catalog
- **Closed:** Shop suspension/reactivation/archive through `SHOP_LIFECYCLE_CHANGE`, version-fenced state CAS, approval execution registry, second person, durable replay receipt and immutable audit. Distinct archive/delete-unused UX and regression tests.
- **Not closed:** sensitive payment-method create/update, enabled/channel/refund-policy/zone changes; tax/service charge settings defaults/overrides and publication lack a separate exact-payload, trusted, runner-connected approval policy. Direct CAS, role checks and audit are necessary but **not second-person approval**.
- **Not closed:** published catalog **large price delta threshold** computed from canonical live-and-draft values; `draft.publish` needs a protected second-person execution fence with replay-safe publication. Current UI approval whitelist correctly does not expose a fictitious rule.
- Catalog copy preview/proposal/stage/publish isolated PostgreSQL coverage includes missing Master Category/Product creation, rebinding and compatible recipe/option scenarios. Unmapped dependencies remain fail-closed.

## G. Plan 3 / Approval and audit
The supported approvals have registered execution paths for refund, return, workforce sensitive mutations, inventory adjustment, finance snapshot, cashier reconciliation, owner withdrawal and shop lifecycle. Durable receipt/lease/replay and trusted permission revalidation are individually evidenced by specialized tests; never infer uncovered actions from this. **Remaining**: Payment/Tax and Catalog price action registration is contingent on protected execution + threshold + tests. Build the runner before adding configurability.

## H. Plan 4 / Inventory and Purchasing
Inventory definition, master-binding, ledger and purchasing cancellation/supplier/PO corrections are present and covered by isolated source/SQL suites. Live recipe→sale→decrement→cost/COGS with a legitimately provisioned worker/device across two shops is **not accepted**. Canonical snapshot contained 0 inventory master bindings and 0 recipe lines, so no live-path proof can be inferred.

## I. Plan 5 / Orders, Customers, Delivery, Menu/Operations
Functional Orders/Customer/Delivery isolated tests and rendered mocked browser tests are part of CI. The previous blocked `task3-customers-postgres` job completed successfully. Authenticated two-shop Admin→live Menu→Operations/POS→ONLINE order acceptance, payment reconciliation and cross-shop isolation are still **unverified**. No PR-specific READY Admin preview existed at Continuation VII inspection.

## J. Plan 6 / Workforce
Current DB read-only structural verification found all 21 distinct source-referenced workforce routines, the active tenant-scoped PIN uniqueness index, business-command uniqueness constraint and terminal approval receipt trigger. The approved `20261015012756_admin_workforce_security_parity` migration previously corrected body drifts. This does not recover historical original SQL bytes; mobile worker PIN/device login with actual two-shop users still needs end-to-end acceptance.

## K. Plan 7 / Finance
- Finance snapshot Z correction, cashier reconciliation variance and OWNER withdrawal are guarded by their dedicated trusted optional second-person policies and isolated PostgreSQL fixtures.
- **Scope ruling for Planner:** `finance.transfer`, bank deposit and owner contribution are documented as auditable money movements with trusted authorization, business-scoped command receipt and ledger, but not independent thresholded approval actions in approved scope. Do not add a new independently configurable transfer rule without Planner ratification of an actual risk threshold. Owner withdrawal remains separately approved.
- Real end-of-day cash/COGS/reconciliation using authenticated worker and actual two-shop order/payment data remains unverified.

## L. Supabase migration reconciliation & impact
- Canonical migrations **196**, latest `20261015231756_admin_shop_archive_lifecycle_approval`, applied with owner authority. Three affected lifecycle/archive RPCs: `SECURITY DEFINER` true; anon/authenticated EXECUTE false; service-role EXECUTE true.
- Read-only production audit at Continuation VII: 1 shop; 7 master categories; 49 master products; 7/49 shop category/product bindings; 0 inventory master bindings; 0 recipe lines. A historical approval request was present at read time, not created by this continuation; do not claim empty all-purpose approval tables.
- Historical provenance: repository 202 timestamped SQL files vs 196 canonical applied entries, with 175 exact name+version matches; 20 source timestamps are aliases, 7 October workforce source-only names, and 21 ledger-only timestamps include a duplicate deployed Plan 3 round-3. Do **not** edit historical SQL files, replay old migrations or forge migration metadata. Check current live schema/definition parity rather than infer absence from timestamp differences.
- Production operational rows have not been changed for testing; no production multi-shop fixture should be inserted to manufacture acceptance.

## M. Planner decision / release gates
**Handoff verdict: CORRECTIONS STILL REQUIRED.** Review these gates and send back a scoped correction ruling:
1. Implement optional high-risk payment-method/channel/refund/zone approval and tax/service-charge setting-write/publish boundary. Require RED→GREEN service/unit/isolated PG and browser tests, exact command ID and version CAS, rule precedence, trusted policy and distinct approver, durable runner/receipt and revocation-safe pending lock.
2. Implement canonical price-delta threshold approval at Catalog publish boundary with snapshot comparisons and crash-safe replay; do not expose rule until its executor is functional.
3. Ratify Finance transfer/deposit/contribution non-approval ruling or supply a separately approved risk rule.
4. Establish isolated, authorized **two-shop** authenticated deployment/data and execute Admin→Menu→Operations/POS/ONLINE→payment/recipe/stock/COGS, negative/isolation cases, workday/worker login and idempotency. Never run destructive production fixtures.
5. Reconcile remaining migration provenance as read-only evidence. No source rewrite for historical versions.
6. Run **all 13 permanent workflows on one immutable final HEAD**, inspect PR review threads, perform whole-branch independent review and correct important findings; update this report with final SHA/log links.
7. Keep PR **DRAFT/UNMERGED** until independent Planner explicitly accepts Plans 1–7. Do not expand into Plans 8–10.

### Primary source and evidence
- Detailed chronological ledger: `docs/superpowers/plans/2026-10-12-tux-admin-pr119-continuation-ledger.md`.
- High-risk approval/action matrix: `docs/superpowers/plans/2026-10-15-pr119-high-risk-approval-coverage-matrix.md`.
- Spec §21.2, §19.3 and finance chapters: `docs/superpowers/specs/2026-09-10-tux-admin-design.md`.
- Archive isolated PG CI: https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/38822164379
- Archive UI rendered CI: https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/38826072564
- PR review: https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/pull/119

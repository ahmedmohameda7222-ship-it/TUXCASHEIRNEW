## Owner-mandated sequential execution correction — 2026-10-26

**Mandatory execution order:** Orders (O1–O4) → Catalog → Inventory → Purchasing → Customers/CRM → Staff → Finance → Reports. **Current exclusive implementation workstream: Orders.** This replaces any prior order implied in this ledger. All other tab changes already committed are retained intact but remain **PARTIAL / NOT ACCEPTED** and MUST NOT be expanded until Orders has all O1–O4 gates passed.

**Safety checkpoint:** Branch `feat/admin-eight-tabs-approved-ui-20261025`, Draft PR #165; at the immediately preceding checkpoint HEAD `b7e0009b223b04fe74822850e5e48555379e1337` (recheck later exact SHA). Fast CI run 40238112883 completed success, including changed-file formatting, typecheck, tests, quality gate. Orders financial RPC and Orders rendered tests passed within run 40238112742; full source regression and six-module browser run were still in progress at inspection. Temporary formatter diagnostic removed; valid later-tab changes preserved. No merge, production deployment or Supabase changes made.

### Strict per-tab acceptance lock
- **Orders O1–O4:** IN PROGRESS — O2 trusted full-shop financial aggregate and O3/O4 hosted integration/visual acceptance remain missing. No DONE status before all O01–O12 requirements have exact-SHA evidence.
- **Catalog C1–C5:** NOT ACCEPTED; only inherited existing Catalog and isolated baseline, no new implementation until Orders closes.
- **Inventory I1–I4:** PARTIAL pre-correction tile work; NOT ACCEPTED.
- **Purchasing P1–P4:** NOT ACCEPTED.
- **Customers/CRM CRM1–CRM4:** PARTIAL pre-correction code/tests; NOT ACCEPTED.
- **Staff S1–S4:** PARTIAL pre-correction code/tests; NOT ACCEPTED.
- **Finance F1–F5:** PARTIAL pre-correction code/tests; NOT ACCEPTED.
- **Reports R1–R5:** PARTIAL pre-correction code/tests; NOT ACCEPTED.
- **Shared P00/P01/P10:** supporting evidence only; never closes a tab.

Keep all unrelated valid commits. Changes in other tabs may only be touched for a verified Orders dependency or non-feature cross-tab regression defect, with justification documented. Preserve all existing approval and operational controls.


# TUX Admin Eight Tabs — implementation progress

**Implementation source:** owner-approved `TUX_Admin_8_Tabs_Implementation_Handoff_REVIEWED_V2.zip` and `03_IMPLEMENTATION_PLAN.md`. Exact progress must be checked against current branch HEAD before continuation; this file is not evidence that a task passed.

## Git baseline / isolation
- Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
- Planner-inspected and independently fetched `main`: `99a56940503deaed656ab211e1309203dbff708d`
- Isolated branch: `feat/admin-eight-tabs-approved-ui-20261025` (created directly from that immutable SHA, never an older PR branch).
- Draft PR: https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/pull/165 — **HOLD: do not merge, promote, or deploy**.
- GitHub API is available through the connected GitHub app. Local `git ls-remote` could not resolve `github.com`; no full local checkout or node_modules was available in the session. Do not claim local commands have passed.
- Existing Catalog #157, Orders/Inventory #163, Purchasing #160 are already integrated in the inspected base. Preserve them. Historic unmerged PRs are not implementation sources.

## Source/reference evidence
- Package verifier: `python VERIFY_HANDOFF.py` — **exit 0**, 117 packaged-file SHA checks, 97 original-reference entries, 8 tab paths, 111 requirement rows.
- Approved Orders visual: `01_Orders/reference_screenshots/01-approved-simplified-orders-desktop-1536.png` — static visual only.
- Approved Inventory visual: `03_Inventory/reference_screenshots/01-inventory-desktop-1440.png` — text-only, light shell.
- Baseline `package.json` and existing Orders/Inventory routes/hooks, shell, reusable primitives and tests inspected from exact main via GitHub.
- Authentication and shop scope remain governed by `ShopScopeProvider` and `useOrders`/`useInventory` endpoints. No server/RPC/SQL contract has been altered.

## Task ledger

| Step | Files | Tests/evidence | State |
|---|---|---|---|
| P00/T0 | This progress file; isolated branch | GitHub main SHA exact; ZIP checksum verifier exit 0; live Supabase project verified | PARTIAL — local baseline scripts unrun |
| P01/T1 | `AdminMetricStrip.tsx`, CSS/test, InventoryPage, OrdersPage | RED-first contract committed; Fast CI all jobs SUCCESS at `98b48f9a30d09c0e7b27f55108dc71d7dd548915`; full shell screenshots pending | PARTIAL |
| P02/O1 | `OrdersPage.tsx`, `orders.css`, `e2e/admin-orders.spec.ts` | Persistent search/secondary filters passed 11/11 Orders browser at `98b48f9a30d09c0e7b27f55108dc71d7dd548915`; later seven-column factual desktop directory and tablet/phone cards committed with new browser assertion, exact-head CI pending | PARTIAL |
| P02/O2–O4 | — | — | NOT STARTED |
| P03/C1–C5 | — | — | NOT STARTED |
| P04/I1–I4 | Inventory summary only | Inventory source counts maintained; full approved layout/screenshots pending | NOT VERIFIED |
| P05/P1–P4 | — | — | NOT STARTED |
| P06/CRM1–CRM2 | — | Full corrected directory/profile layout, activity, pagination and authorization still pending | NOT STARTED |
| P06/CRM3–CRM4 | `CustomersPage.tsx`, `crmMutationGuard.ts` and unit/browser specs | Guard denies application-level `ok:false` for adjustment/policy and prevents false success toast; preserve dirty policy on refetch and reset draft on shop switch; verified focused CI status must be read at exact HEAD | PARTIAL — E2E / hosted business rules pending |
| P07/S1–S4 | — | — | NOT STARTED |
| P08/F1 | `FinanceSectionNav.tsx`, 4 Finance call sites, `routes.tsx`, `FinanceReconciliationPage.tsx`, Finance unit/browser specs + CSS | Three primary sections; existing advanced settlements/Z routes preserved by permission-gated disclosure; first rendered run 38/39 passed at `afe53de5` with exact-heading test selector fixed later; physical Operations source not supplied | PARTIAL — F4 NOT COMPLETE |\n| P08/F2–F5 | Finance readonly facts only, no Ops counted-method projection | F4 needs actual Operations per-method physical count source and cross-app proof; F2/F3/F5 not implemented | NOT VERIFIED |
| P09/R1–R5 | — | — | NOT STARTED |
| P10/G2 | `.github/workflows/admin-eight-tabs-rendered.yml`, `e2e/premiumVisualEvidence.ts` | Scoped Chromium acceptance now covers Orders, Inventory, Finance and CRM; `TUX_ADMIN_EIGHT_TABS_CAPTURE=1` captures six widths (360/390/768/1024/1440/1536) in artifact. Current new screenshot exact-head run pending; mock-auth screenshots are not hosted acceptance | PARTIAL |\n| P10/G1/G3 | — | Hosted cross-app and final owner approval still required | NOT STARTED |

### Requirements evidence (never promote from source inspection to PASS)
- `O03`: Four approved metric labels rendered using a shared primitive, but numbers are explicitly unavailable until authoritative entire-shop aggregate and finance permissions are implemented. **NOT VERIFIED**, KPI service blocker.
- `I02`: Reusable tiles take shop-scoped `inventoryCounts(items)` from authenticated workspace; no monetary totals or fabricated movement count. Still requires pagination-completeness and rendered comparison. **NOT VERIFIED**.
- Finance F1 primary navigation and read-only partial F4 are implemented, but **NOT VERIFIED against approved screenshot or hosted Operations count**. Operations count absent from trusted Finance day contract; payment breakdown must not be presented as physical actual.\n- Every requirement among all 111 rows remains **NOT VERIFIED for final acceptance** until task-specific source/runtime evidence is linked in the coverage matrix. This progress ledger is not a substitute.

## Later implementation checkpoint
- Completed source-level work after the initial Finance checkpoint: CRM terminal-result guard, unsaved policy refresh protection and 2 browser regressions; seven-column Orders desktop directory with responsive table-to-card layout and a new browser assertion.
- Screenshot capture workflow writes mock-auth Chromium screenshots for Orders/Inventory/Finance/CRM at the exact approved review widths and stores them as GitHub Actions artifacts. Capture availability and visual parity require reviewing a completed exact-head run.
- As of commit `3b9bfafaa76d34c5c0c08ce3c275ae796f8b76ed`: Orders financial PostgreSQL acceptance succeeded; Fast CI, isolated Orders rendered/full regression and the four-module Chromium+screenshots job were still in progress. **Do not imply they passed.**
- No SQL, Supabase migration, production deployment or branch merge was executed for these changes. Existing Finance method totals cannot be reclassified as Operations physical counts.

## Supabase development state
- Live project `TUX V2`, ref `awpdcsayuwbsruwvaosg`, region `eu-central-1`, `ACTIVE_HEALTHY` confirmed via connected account `TUX V2 And masjid`.
- Existing migration tail observed from `20261025150000` through `20261025180000`, including Inventory off-shift, master identity/stocktake protections and Purchasing replay fence.
- **No new migration created or applied; no SQL/data writes.** Later migration work must use targeted local PostgreSQL tests and independent schema-effect verification.

## Verification / environment blockers
- Local full-checkout commands: **NOT RUN**, sandbox GitHub DNS unavailable. GitHub-hosted `npm ci`, Admin TypeScript, changed-file lint/format, scoped Vitest, Orders isolated PostgreSQL, 11 Playwright Orders tests and full source production builds executed and **PASSED at `98b48f9a30d09c0e7b27f55108dc71d7dd548915`**. Subsequent Finance commits require new exact-head checks.
- Subsequent GitHub CI results are immutable per SHA, not inherited across changes. Finance first run at `73ebfcfa9616da3f792b8ea964847c81d6fdf0f4` caught incorrect test currency formatting, later fixed. Cross-tab rendered at `afe53de5f69237f0b487fd8c0ea463ab30439a4a`: 38/39 browser pass; one ambiguous heading-selector test, later fixed; latest exact-head rerun must be read.
- Running React desktop/mobile screenshots: **NOT CAPTURED**; source reference image is not actual UI evidence.
- No hosted auth/live cross-app acceptance attempted or claimed.

## Resumption / next exact actions
1. Obtain exact GitHub branch/PR head, inspect workflow result and any failing logs, correct by RED→GREEN.
2. Run shell + `AdminMetricStrip` and relevant Orders/Inventory tests in CI with line-level evidence.
3. Finish P01 screenshots at 360/390/768/1024/1440 and Orders 1536, then O1 full cursor/selection suite and O2 authoritative shop-wide KPI route; **never use the paginated 50-row result to calculate totals**.
4. Finish F1 visual review and F4 canonical Operations method-count projection; **no actual amount derived from existing Finance recorded-payment totals**. Then continue C/I/P/CRM/S/F/R by the approved plan and update all 111 requirement proof states.
5. No merge, Vercel production deploy or Supabase structural change without its specific verified migration and approved release gate.

**Ruling:** Orders four metric cards show `Unavailable` rather than zeros or synthetic figures before the authorized aggregate exists. The approved handoff specifically permits honest nullable/loading state until O2; the cost is incomplete KPI presentation until O2 implements the backend.

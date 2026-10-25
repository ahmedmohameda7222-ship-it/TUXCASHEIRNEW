# TUX Admin Eight Tabs — implementation progress

**Implementation source:** owner-approved `TUX_Admin_8_Tabs_Implementation_Handoff_REVIEWED_V2.zip` and `03_IMPLEMENTATION_PLAN.md`. Exact progress must be checked against current branch HEAD before continuation; this file is not evidence that a task passed.

## Git baseline / isolation
- Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
- Planner-inspected and independently fetched `main`: `99a56940503deaed656ab211e1309203dbff708d`
- Isolated branch: `feat/admin-eight-tabs-approved-ui-20261025` (created directly from that immutable SHA, never an older PR branch).
- Draft PR: pending first implementation checks; **do not merge, promote, or deploy**.
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
| P01/T1 | `AdminMetricStrip.tsx`, `AdminMetricStrip.css`, `AdminMetricStrip.test.tsx`, `InventoryPage.tsx`, `OrdersPage.tsx` | RED contract committed prior to component, GREEN code committed; exact-head GitHub CI and browser pending | NOT VERIFIED |
| P02/O1 | Orders partial four-KPI placement only (no aggregate implementation) | Backend totals intentionally null, never derived from page of 50; Orders responsive/layout E2E pending | NOT VERIFIED |
| P02/O2–O4 | — | — | NOT STARTED |
| P03/C1–C5 | — | — | NOT STARTED |
| P04/I1–I4 | Inventory summary only | Inventory source counts maintained; full approved layout/screenshots pending | NOT VERIFIED |
| P05/P1–P4 | — | — | NOT STARTED |
| P06/CRM1–CRM4 | — | — | NOT STARTED |
| P07/S1–S4 | — | — | NOT STARTED |
| P08/F1–F5 | — | — | NOT STARTED |
| P09/R1–R5 | — | — | NOT STARTED |
| P10/G1–G3 | — | — | NOT STARTED |

### Requirements evidence (never promote from source inspection to PASS)
- `O03`: Four approved metric labels rendered using a shared primitive, but numbers are explicitly unavailable until authoritative entire-shop aggregate and finance permissions are implemented. **NOT VERIFIED**, KPI service blocker.
- `I02`: Reusable tiles take shop-scoped `inventoryCounts(items)` from authenticated workspace; no monetary totals or fabricated movement count. Still requires pagination-completeness and rendered comparison. **NOT VERIFIED**.
- All remaining 109 rows of `10_REQUIREMENTS_COVERAGE_MATRIX.md`: **NOT VERIFIED** (no PASS without exact-head execution + evidence).

## Supabase development state
- Live project `TUX V2`, ref `awpdcsayuwbsruwvaosg`, region `eu-central-1`, `ACTIVE_HEALTHY` confirmed via connected account `TUX V2 And masjid`.
- Existing migration tail observed from `20261025150000` through `20261025180000`, including Inventory off-shift, master identity/stocktake protections and Purchasing replay fence.
- **No new migration created or applied; no SQL/data writes.** Later migration work must use targeted local PostgreSQL tests and independent schema-effect verification.

## Verification / environment blockers
- Actual `npm ci`, `npm run format:check`, `npm run lint`, `npm run typecheck:admin`, `npm run test`, `npm run test:e2e:admin`, `npm run test:e2e:menu`: **NOT RUN** — full repository checkout blocked by local GitHub DNS resolution, not PASS.
- Dedicated GitHub CI and full regression on the PR must be inspected before advancing status.
- Running React desktop/mobile screenshots: **NOT CAPTURED**; source reference image is not actual UI evidence.
- No hosted auth/live cross-app acceptance attempted or claimed.

## Resumption / next exact actions
1. Obtain exact GitHub branch/PR head, inspect workflow result and any failing logs, correct by RED→GREEN.
2. Run shell + `AdminMetricStrip` and relevant Orders/Inventory tests in CI with line-level evidence.
3. Finish P01 screenshots at 360/390/768/1024/1440, then proceed O1 list/filters and O2 authoritative shop-wide KPI route; **never use the paginated 50-row result to calculate totals**.
4. Continue C/I/P/CRM/S/F/R stages in task order and update each of the 111 requirement proof states.
5. No merge, Vercel production deploy or Supabase structural change without its specific verified migration and approved release gate.

**Ruling:** Orders four metric cards show `Unavailable` rather than zeros or synthetic figures before the authorized aggregate exists. The approved handoff specifically permits honest nullable/loading state until O2; the cost is incomplete KPI presentation until O2 implements the backend.

## Orders O11 mobile negative-action acceptance — 2026-10-26 (newer checkpoint)

**Exact verified source SHA `da2c308a604bf8c98329c3581615c57f6e4a587d`: All four CI groups SUCCESS.** Orders full build/isolated PG/32 of 32 Chromium tests [40245652024](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245652024); Fast CI including TypeScript, unit/integration, formatting, security and migration chain [40245652015](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245652015); Business Day PostgreSQL [40245652009](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245652009); multi-module Chromium regression [40245652096](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245652096). All conclusions read directly from exact-commit workflow jobs.

**New O10/O11 proof:** `e2e/admin-orders.spec.ts` tests mobile 390px Escape in the real `CancelOrderSheet`: existing dialog closes, keyboard focus returns to `Cancel order`, unsent Admin PIN clears on remount, and no POST order mutation occurs. Browser job 121326531884 passed **32/32**, including this test. The tested source is unchanged from `dc135ee1...` except for the new test and ledger documentation. This proof is **mock-auth Chromium**, not live SSO/Owner UAT.

**Still blocked (do not close Orders or advance Catalog):** protected Admin Preview is READY from `dc135ee1...` but has no authenticated matching-sha Operations/Menu acceptance→Admin→Finance/Reports full transaction proof; mobile visual design has no approved screenshot, requiring Owner signoff. All other tabs remain frozen partial/not accepted, PR #165 DRAFT/HOLD, no Production merge/deploy/SQL.


## Orders-only exact-HEAD CI, hosted Preview and financial ledger proof — 2026-10-26

**Inspected code SHA:** `dc135ee1f7488e63e53d69b8be945b855d446ebc`. PR #165 remains **Draft/HOLD**, not merged. No Production deployment/migration and no later-tab feature work. Approved fixed execution sequence remains Orders → Catalog → Inventory → Purchasing → Customers/CRM → Staff → Finance → Reports. This checkpoint is newer than previous ledger entries below.

**Exact-SHA GitHub validation:** All four workflows completed **SUCCESS**: TUX V2 CI run [40244873868](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40244873868), Orders isolated PostgreSQL + full build + Chromium run [40244873832](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40244873832), P0 Business Day PG [40244873829](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40244873829), and six-tab browser safety [40244873820](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40244873820). Migration timeout updated from 3 to 12 minutes because a prior valid test run was cancelled in teardown, not because SQL failed.

**Corrected actual refund acceptance:** On Orders real isolated PG job `121324211216`, verified full scope: 67 orders, 17 ACTIVE, 58 paid; POSTED refund 250 minor and separately PENDING_APPROVAL refund 100 minor. Only posted refund reduces revenue, producing **82,750 minor net** and **1,427 minor AOV**; the following refund-only day produces **−250 minor net** with zero placed orders and null AOV. The earlier 83,000/1,431 historical figures below are **superseded** and did not prove nonzero refund subtraction. Isolated database has 32 correctly correlated real Menu-request reservations; no online trigger disabled.

**Independent development Supabase ledger reconciliation:** Authorized shop's `admin_orders_kpis_v1` returned 5 placed, 0 ACTIVE, 5 paid, 106,000 minor net, 21,200 minor AOV, agreeing with separately aggregated `public.orders`, `public.payments` and POSTED `public.admin_order_refunds` on the same 2026 period. This is **development database parity**, NOT an authenticated hosted Operations → Admin → Finance multi-app checkout. Unauthorized RPC and role/execution ACLs were independently tested previously.

**Admin Preview deployment (not Production):** Vercel `dpl_vyVCZC4cXBZukPyNEEfPR1k9j8xc` was created specifically from `dc135ee1...` at `https://tuxcasheirnew-admin-4kvi7bvoo-ahmed-s-projectssasa.vercel.app`; inspected `READY` and `target=null` (Preview). Project has Vercel SSO protection, so READY is **not** authenticated hosted acceptance. Do not disable security to run acceptance. No same-SHA Operations/Menu previews or complete hosted PIN-auth UAT proven.

**Orders screenshot evidence:** real mock-auth Chromium native-viewport image `orders-reference-1536x1024.png` and 360/390/768/1024/1440/1536 width captures in the `orders-rendered-evidence` artifact of run 40244873832 (downloaded local archive `tux-orders-exact-dc135ee-browser-evidence.zip` for review). Approved static reference only exists for desktop; there is **no approved phone image**. Implemented screenshot retains the original live light shell, 60/40 KPI/list + full inspector, 1100px detail transition, real backend-scoped controls, no invented growth/avatars/bulk actions; remaining visual differences include original shell proportions and just two mock-auth fixture rows versus illustration's 10. Requires Owner visual review, not claim of pixel-perfect parity.

**Requirement disposition O01–O12:** O02/O03/O05/O06/O07/O08/O09 source/isolated PG/browser checks pass; O04 now covers posted/pending refund accounting and date attribution; O01/O11 still need Owner screenshot sign-off, O10 still needs hosted negative PIN storage/trace review, O12 **BLOCKED** on authenticated same-order Operations POS or Menu acceptance → Admin → Finance/Reports consistency on matching Preview/Supabase. No Orders O1–O4 phase or complete tab is approved. No Catalog implementation permitted yet.


## Orders O1–O4 independent acceptance checkpoint — 2026-10-26

**Owner execution directive is still mandatory:** ORDERS ONLY until full O01–O12 acceptance; then Catalog → Inventory → Purchasing → Customers/CRM → Staff → Finance → Reports. All later-tab partial commits are preserved, frozen and **NOT ACCEPTED**. PR #165 is DRAFT/HOLD; no merge, no Production deployment or Production SQL.

**Latest Orders implementation code checkpoint:** `9a4a67a81248d1a6233cd8377fc327daaef491d4` (revalidate HEAD before citing future checks). All visible code changes in this round are confined to Orders page/inspector/browser tests and temporary formatter workflows removed after use. Supabase KPI migration `20261025221507 orders_authoritative_kpis` was already present in development TUX V2; no new remote SQL applied by this checkpoint.

**Verified test evidence, ordered by actual SHA:** On source SHA `94afd26e3054450830d9d16c7e59c67d0ffabb10`, Orders isolated PostgreSQL acceptance run [40244143965](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40244143965) passed all three jobs (real financial RPC, all-workspace regression/builds, browser acceptance). Its changed-file formatting job failed on exactly two files (Orders inspector article and browser test locator); an exact Prettier workflow identified the diff, and both were corrected in `b453cf7` and `3545fd4`; final exact-HEAD re-verification is required. The preceding O3 print cycle went RED (hidden archival facts even under print CSS) → GREEN with browser-native `beforeprint`/`afterprint` event handling; original open/closed state is restored after printing. The latest actual Chromium viewport screenshot is `artifacts/p04-p07/orders-reference-1536x1024.png` in the Orders job's `orders-rendered-evidence` artifact, 1536×1024 native screenshot rather than a full-page image falsely compared to the reference.

**Current Orders requirement coverage (L = browser/unit, P = isolated PostgreSQL/DEV RPC, H = authenticated hosted, V = screenshot review):**

| Requirement | Implementation / exact evidence | Acceptance disposition |
| --- | --- | --- |
| O01 — selected approved 1536 reference | Real Chromium screenshot visually inspected alongside the selected `01-approved-simplified-orders-desktop-1536.png`. Approved light shell retained; image-only design, no fake Orders HTML. Differences: existing real app sidebar/header dimensions, actual rows from fixtures not illustrated 10, real cursor pagination not fake numbered pages, no synthetic growth. | **V PARTIAL** — Owner visual sign-off pending. |
| O02 — light shop shell and wide master/detail | Scoped `OrdersPage.tsx`, `orders.css`; canonical wide KPI/list uses about 60%, inspector about 40%; 1100px and below switches to focused detail with Back. Exact Chromium geometry checks. | **L/V PASS source**, hosted shell check outstanding. |
| O03 — four exact KPI labels and no fake growth | `AdminMetricStrip` + `AdminOrderKpisResult`; live full-population server query and permission-masked amount; browser 65-record fixture vs only 2 listed rows, no fake comparison percentages. | **L/P PASS**, unverified authenticated hosted. |
| O04 — recognized revenue/AOV/full shop >50 | Disposable real PG script `scripts/test-admin-orders-kpis-postgres.mjs`; **67 placed, 17 ACTIVE, 58 distinct paid, net 83,000 minor, AOV 1,431 minor, 8 bounded, 32 ONLINE requests matched by enabled integrity trigger**; split tenders, posted refund treatment, denied external EXECUTE. DEV Supabase function metadata independently verified. | **P PASS**, hosted Operations→Orders→Finance same-record audit outstanding. |
| O05 — search/status/source/dates/clear | Persistently visible search and secondary real filters; Cairo converted UTC instants, reversed filters fail closed; reset supports React Query cached unfiltered result. `e2e/admin-orders.spec.ts`. | **L PASS**, hosted verification outstanding. |
| O06 — type vs POS/ONLINE source / Cairo / sort | Two distinct real source and type columns; Cairo timestamp presentation; unsupported numeric paging/sort omitted. Component and browser. | **L PASS**, hosted verification outstanding. |
| O07 — nextCursor and 20s poll | `useOrders.ts` server cursor, `fetchNextPage`, `ORDER_REFRESH_INTERVAL_MS=20_000`, independent KPI query; browser checks no duplicate/cursor aggregate change. | **L PASS**, live Operations invalidation proof outstanding. |
| O08 — immutable inspector chronology | Refactored compact real order header, 6 accessible anchors, customer/fulfillment before detailed items, modifier extras, financial correction, payment, inventory and audit preserved; full archival details via native disclosures. RED→GREEN print lifecycle regression. | **L/V PASS source**, hosted full order parity outstanding. |
| O09 — protected cancels/refunds/returns | No paid-ACTIVE Admin cancel; DONE/RETURNED refund/return only if permitted; PIN/reason/approval/idempotency protections unchanged; real Postgres paid cancellation rollback/second-person tests passed. | **P/L PASS**, hosted approval/Finance outcome outstanding. |
| O10 — PIN and unsupported actions | PIN used for reauthentication but omitted from retained idempotent intent; no New Order/bulk financial edits. Existing mutation/API security checks passed; verify logs/storage in hosted UAT. | **L/P PARTIAL**, hosted negative assertions missing. |
| O11 — mobile/tablet/zoom | Rendered actual Chromium 360/390/768/1024/1100 and 1440/1536, no body overflow, navigation/cancel sheet tests, 720px CSS viewport 200%-zoom equivalent, keyboard-linked 6-section inspector. | **L/V PARTIAL** — selected Orders handoff has NO approved phone image; Owner mobile visual review needed. |
| O12 — shop switch and Operations/Menu/Finance parity | E2E same-shop/foreign detail denial and shop selection clearing; isolated PG proves 32 genuine correlated Menu requests with trigger ON, no first-page money totals. Checked Vercel connector deployments for implementation HEAD and found no exact-SHA preview. | **H BLOCKED** — no authenticated hosted exact-SHA order placement→Admin→Finance parity yet. |

**Actual visual comparison (approved vs generated at `94afd26`):** geometric two-column composition and all four KPI numeric labels align qualitatively; 1536 desktop status, revenue and item-caption wrapping verified fixed by Playwright. Remaining differences are existing shell dimensions, no unsourced avatars/photos/growth/sort, actual backend-scope controls, limited two-order fixture, and longer preserved financial/inventory history behind real in-document navigation and disclosures. This is a screenshot-based implementation review, NOT an Owner-approved pixel-perfect acceptance.

**Final Orders release blockers:** authoritative authenticated hosted Operations POS paid/DONE/order update → Admin → Finance/Reports and Menu online acceptance on the *same* deployment and database with real session permissions; exact-head visual artifact and complete CI rerun after final formatting; Owner acceptance of the newly designed mobile view and documented desktop shell differences. **Do not close Orders or proceed to Catalog** until these gates are explicit. No production promotion or merge has occurred.

## Orders-only execution acceptance ledger — 2026-10-26 (latest evidence, supersedes historical rows)

**Owner's strict sequential lock:** Orders **ONLY** until O1–O4 final acceptance. All other tabs remain **NOT ACCEPTED**, with previous partial code preserved and no further non-Orders changes. Current PR is #165, Draft/HOLD. Always re-check HEAD/CI before advancing.

| Scope | Actual work/evidence | Verdict |
|---|---|---|
| **O1 — list, search, server filters, cursor/detail** | Persistent search/filter disclosure, seven factual desktop columns with compact mobile layout, honest shop context; working source-preserved backend cursor `Load more`, dynamic shop reset, online mode. Browser cases including 2-page fixture added `e2e/admin-orders.spec.ts`; latest exact-head Chromium check required | **PARTIAL, not accepted** |
| **O2 — full authoritative KPIs** | New `GET /api/admin/orders?view=kpis` → `queryOrdersKpis` → service-role-only `admin_orders_kpis_v1`, with both app-server permission and DB scope checks; independent of 50-row page; recognized allocated payments minus POSTED refunds, distinct paid denominator, null zero AOV and masked money for non-finance users. Unit and >50 real PG security/ledger tests. Development Supabase migration applied; parity verified against existing canonical orders/payments. Browser/e2e screens and exact-head all-green still required | **PARTIAL, not accepted** |
| **O3 — detail, sensitive action/financial and inventory chronology** | Existing `OrderDetailPage`, `CancelOrderSheet`, `RefundReturnPage`, PIN/reasons/second approval paths preserved. Existing standalone Orders full-regression PG verifies refund, approval, paid-ACTIVE cancel rollback, command replay. Additional deliberate O3 double-submit/changed-payload/cross-app acceptance, exact UI inspector parity remain to be evidenced | **PARTIAL, not accepted** |
| **O4 — visual and cross-app acceptance** | Existing screenshot capture widths 360/390/768/1024/1440/1536 in `admin-eight-tabs-rendered.yml` and approved Desktop reference inspected. Exact image comparison, hosted authenticated POS → Orders → Finance/Reports and Menu ONLINE → Orders verification, no-overflow/full accessibility proof and Owner sign-off not complete | **NOT ACCEPTED** |
| **Orders requirement coverage** | O01–O12 each requires evidence; no final PASS inferred solely from source edits or isolated tests | **INCOMPLETE** |
| **Remaining tab order** | Catalog → Inventory → Purchasing → Customers/CRM → Staff → Finance → Reports, one tab at a time | **LOCKED; none accepted** |

### Development Supabase migration and direct independent evidence

- **Code migration file:** `supabase/migrations/20261026000000_orders_authoritative_kpis.sql`, source blob digest `2566597e0335140943982cde62f3b1c05ede089c`.
- **Actually applied to authorized TUX V2 dev Supabase project `awpdcsayuwbsruwvaosg`:** migration history `20261025221507 orders_authoritative_kpis`, source and assigned version deliberately recorded separately. Do not reapply the SQL or mistake history's generated version for repository filename.
- **Runtime ACL:** security definer with pinned search_path; anon and authenticated cannot EXECUTE; service_role can. Unauthorized actor returned `permission_forbidden`. No Production deployment/migration.
- **Actual existing dev data:** one authorized shop has 5 orders, zero active, 5 paid, 106000 minor recognized net, 21200 minor AOV; four independent shop-scope comparisons returned `true`. Existing five orders were not mutated.
- **Disposable PostgreSQL:** `scripts/test-admin-orders-kpis-postgres.mjs` reuses current orders approval fixture, seeds 64 more canonical mixed POS/ONLINE records under real Menu pending-request/Operations-device reservations with ONLINE correlation trigger **always enabled**, split Card/Cash payments, verifies complete counts beyond page 50, source and date filtering, permission denials, null average and EXECUTE grants. Job 121310275366 in Orders acceptance run 40240239485 **SUCCESS**; same run Orders rendered job 121310275090 and all monorepo build/regression job 121310275331 **SUCCESS**, at prior exact HEAD `2156138a4df3000b04c105af54fc79e473278c73`. Do not transfer PASS to a new HEAD.
- Earlier fixture attempts bypassed trigger temporarily; that defective technique was corrected and replaced with actual valid pending-request/reservation setup **before these passing results**. This checkpoint must retain the corrected enabled-trigger source.
- Last direct exact-head checks and browser screenshots still pending when this ledger was written; continue only Orders and preserve failed/cancelled runs transparently.


## Orders-only O2 checkpoint — 2026-10-26

**Execution lock remains in force:** Orders first. Catalog, Inventory, Purchasing, CRM, Staff, Finance and Reports are still not accepted. No new later-tab features in this checkpoint.

- O2 source: `apps/admin/server/orders/orderKpiService.ts`, `apps/admin/api/admin/orders.ts`, `apps/admin/src/orders/useOrders.ts`, `OrdersPage.tsx`, `packages/admin-contracts/src/orders.ts`; independently authorized `admin_orders_kpis_v1` migration `supabase/migrations/20261026000000_orders_authoritative_kpis.sql`.
- Strict KPI policy: order count includes complete placement population regardless of browser 50-row cursor; active count uses canonical ACTIVE status; net revenue uses allocated payment ledger minus POSTED refunds at refund event date, aligned to canonical Finance/Reports; AOV denominator is distinct paid orders; zero denominator produces null; denied `finance.view` masks all financial fields. Query is scoped to one authorized shop and UTC instants translated from Cairo local filters.
- **Real isolated PG acceptance PASS** (Orders PostgreSQL job 121309682825, run 40240041540 on `d8b6cae4e302f950aca697b3d95272a3244a02e4`): 67 total, 17 ACTIVE, 58 distinct paid, 83,000 EGP minor net and 1,431 minor AOV, 8 bounded range, 32 real persisted ONLINE request correlations with trigger kept enabled; denied unauthorized actor/foreign shop and malformed period; `anon` + `authenticated` cannot EXECUTE, `service_role` can. See `scripts/test-admin-orders-kpis-postgres.mjs`.
- **TUX V2 development Supabase applied:** recorded migration `20261025221507 orders_authoritative_kpis`; `public.admin_orders_kpis_v1(uuid, uuid, timestamptz, timestamptz)` metadata inspected, function digest `a666ce5120b26b25357f760d7c136179f38ac38ba5a695ba9aba00cb23e72b79`; `anon_exec=false`, `authenticated_exec=false`, `service_exec=true`. A read-only invocation for an actively authorized Owner/Admin shop returned `ok=true, orderCount=0, activeOrderCount=0`; AOV correctly undefined. No production deploy or unrelated database data changes in this checkpoint.
- **O2 STATUS: PARTIAL / NOT TAB-ACCEPTED.** Browser route/visual, the full exact-SHA monorepo build/security suite, real Admin ↔ Operations ↔ Menu ↔ Finance acceptance and full O01–O12 requirement proof must be checked before Orders can close. Do not label O1–O4 or any other tab complete from a single passing PG fixture.
- Historical paragraphs lower in this ledger describe **prior checkpoints** and may say there was no migration: this O2 checkpoint supersedes those historical statements. Recheck current HEAD and workflow results before every completion claim.


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

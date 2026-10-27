## 2026-10-27 Purchasing P2 PRE-MERGE ENGINEERING PASS — P3 exclusively unlocked

**Accepted immutable code HEAD:** `e56043211fd22b176ba8630ae07b088d6ef0aa10` on open **Draft PR #165** (no merge, deploy, or Production SQL). Eight exact-code-head GitHub Actions workflow groups completed **SUCCESS**:
- [Fast CI 40528187280](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187280): changed-file formatting/lint, admin TypeScript, 221/221 focused unit/integration tests, security, migrations, required gate GREEN.
- [Purchasing isolated real PG + security + 390/360 responsive Chromium 40528187902](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187902): all three jobs GREEN.
- [Combined mainline real PG, source/build and Admin/Operations/Menu Chromium 40528187699](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187699): all three GREEN, enforcing the already squash-merged Purchasing ancestor.
- [Full monorepo regression 40528187762](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187762): all Admin, Menu, Windows, security, architecture, Branch/PIN and required gate jobs GREEN.
- [Orders isolated PG 40528187774](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187774): GREEN.
- [Inventory isolated real PG 40528187630](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187630): GREEN.
- [P0 Business Day real PG 40528187693](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187693): GREEN.
- [Six-tab responsive browser 40528187277](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40528187277): GREEN.

**P2 RED→GREEN corrections:** Previously approved PO editor and creation retain real draft/ordered/partially received/received/cancelled lifecycle, canonical display/reference, zero inventing, source/API/RPC permission and version fences. New failing regression `DraftPurchaseOrderLinesEditor.test.tsx` proved existing `formatPurchaseMicros(expectedPurchaseUnitCostMinor * 10000)` throws `invalid_micros` on still valid safe integer minor costs (RED fast CI 40525536330); fixed with `formatPurchaseMoneyMinor` using BigInt on minor units (GREEN at exact accepted SHA). Mobile 390px E2E `P2 mobile item cost retains every persisted safe-integer EGP minor unit` required `90071992547409.90 EGP`, which was rendered `...91` by `toFixed`/floating math (RED prior source), fixed by exact formatter for expected item costs and actual historic receipt costs. Purchase order totals still use existing validated BigInt integer minor calculations, no client fake transaction/posted payment substitution. Newly built components and browser tests preserve mobile layouts; no unrelated tabs or SQL touched.

**Ruling:** P2 accepted **pre-merge engineering scope only**, not final exact pixel-perfect Owner QA, hosted authenticated real-production testing or merge. **P3 exclusively ACTIVE**, P4 + all later tabs locked; existing work preserved. Production migrations/data and deployments unchanged.

---

## 2026-10-27 Purchasing P1 PRE-MERGE ENGINEERING PASS — P2 exclusively unlocked

**Immutable accepted code HEAD:** `5bd71f9f7bcc21581c394ede3b09d66143c47fc7` on open Draft PR #165, not merged. Exactly eight workflow groups were verified **SUCCESS on the same SHA**:
- [Fast CI 40523343586](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343586) — TypeScript, changed-file Prettier/lint, unit, security, migration and required gate.
- [Purchasing PostgreSQL + security + rendered 40523343593](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343593) — all three jobs green, 33/33 Purchasing browser tests including new P1 phone fallback-ID search and desktop first PO inspector. Screenshot artifact `12742522584`, generated at exact HEAD.
- [Integrated Purchasing/mainline 40523343643](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343643) — combined full source/build, combined Orders/Inventory/Purchasing real PostgreSQL and combined Admin/Operations/Menu Chromium all SUCCESS.
- [Orders PostgreSQL/browser/build 40523343735](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343735) — SUCCESS.
- [Inventory I3 real PG 40523343543](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343543) — SUCCESS.
- [P0 Business Day real PG 40523343568](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343568) — SUCCESS.
- [Six-tab responsive browser 40523343561](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343561) — SUCCESS.
- [Full monorepo/Chromium 40523343563](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40523343563) — eight jobs GREEN including Admin (345 passed, 19 skipped), Windows, Operations/Menu, security, architecture and required gate.

**P1 RED→GREEN fixes:** a PO with no supplier reference displayed a deterministic `PO-XXXXXXXXXXXXX` identifier but could not be found by searching that exact displayed reference; verified failing 390px Chromium before adding `purchaseOrderDisplayReference(order)` to scoped search. Desktop `/purchasing` now selects first visible newest shop-authorized PO into adjacent inspector, but 1150px and below remain list-first and require explicit PO choice. Existing status/supplier filters, page of ten **loaded** rows and truthful loaded-only counts retained. Fixed `.github/workflows/purchasing-shadow-integration.yml` ancestry from an obsolete unmerged PR #160 SHA to the actual already squash-merged Purchasing main baseline `99a5694...`, with `git compare` evidence old tip diverged; preserved all real PG and migration verification, integrated source tests succeeded. Source changed only Purchasing UI, its E2E and Purchasing-specific CI; no new SQL or live backend mutation.

**Ruling:** P1 is accepted at **pre-merge engineering scope only**, not final approved pixel-perfect UI, hosted authentication/Owner physical UAT, or a guarantee of exhaustive older cancelled PO history (backend includes latest 500 plus all actionable; UI labels loaded-only counts). **P2 exclusively unlocked**. P3/P4, CRM, Staff, Finance, Reports remain locked; already-valid code preserved. No merge, deployment, Production SQL or seeding.

---

## 2026-10-27 Inventory I4 PRE-MERGE ENGINEERING PASS — Purchasing P1 unlocked

**Accepted immutable source HEAD:** `00a568bf9553f2f507fb271fa92f23059fefe672` (Draft PR #165, open; **NOT merged**). Six exact-HEAD GitHub Actions workflow groups **SUCCESS**:
- [Fast CI 40515960527](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960527) — related tests, TypeScript, changed-file Prettier/lint, security, migration checks and quality gate all GREEN.
- [Inventory isolated real PostgreSQL 40515960694](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960694) — Adjust/Waste + Purchasing receive/return bridge GREEN.
- [Orders real PostgreSQL/browser/build 40515960560](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960560) — all three jobs GREEN.
- [P0 Business Day real PostgreSQL 40515960506](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960506) — applicable RPC job GREEN; unrelated conditional Inventory jobs SKIPPED, never claimed executed.
- [Six-tab responsive Chromium 40515960913](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960913) — complete browser acceptance GREEN; screenshot ZIP `admin-eight-tabs-rendered-evidence` artifact `12738909300` on accepted exact SHA.
- [Full monorepo + Chromium 40515960530](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40515960530) — all 8 jobs GREEN including Admin, Menu, Windows, quality, branch/PIN, architecture, edge security and required gate; Admin screenshots artifact `12738603974`.

**I4 engineering source closure:** After-shift-only physical stocktake control and persisted draft save/resume/stale-block/cancel/post; up-to-500 per-session batching for >500 active items; authoritative stock preservation; master-constrained send/receive/cancel transfer, true micros at six decimals in transfer history, quantity formatting on resuming stocktake, no repeated transfer draft after acknowledged send, mobile 390px reorder policy rejects sub-micro rounding, exact signed variance display and CSV-safe precise values. RED→GREEN regressions included failed screenshot/browser policy at previous HEAD, exact-count assertion after grouped numeric edit, zero-rounded 1-micro transfer, and mobile transfer resend. Tests verify source contract and in-memory mocked browser flows; **not** a claim of exhaustive live PostgreSQL I4 race tests, final hosted physical testing, or pixel-perfect parity. No new SQL or live data change in I4.

**Sequential decision:** Orders O1–O4, Catalog C1–C5 and Inventory I1–I4 now have PRE-MERGE ENGINEERING PASS. **Purchasing P1 exclusively ACTIVE**; P2–P4, CRM, Staff, Finance and Reports remain locked/NOT ACCEPTED. Preserve previously committed partial source changes in those modules. The approved handoff describes Purch #160 already merged to main, so P1 is delta/parity work, not rewrite. Final production/Owner physical UAT remains DEFERRED until all tabs and separately authorized squash merge. No merge, no deployment, no Production migration/data mutation.

---

## 2026-10-27 Inventory I3 PRE-MERGE ENGINEERING PASS — I4 exclusively unlocked

**Immutable accepted code HEAD:** `71b73993fc32abee93fc89833f7a48faa0d9de2c` on Draft PR #165. Verified all exact-head workflows completed with **SUCCESS**:
- [Fast CI + required quality gate 40508204881](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204881).
- [Real isolated PostgreSQL Adjust/Waste + Purchasing receipt/return bridge 40508204806](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204806).
- [Six-tab rendered Chromium/mobile acceptance 40508204945](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204945).
- [Orders isolated PostgreSQL/Chromium/builds 40508204802](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204802).
- [P0 Business Day PostgreSQL 40508204898](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204898).
- [Full monorepo/Chromium + required quality gate 40508204930](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40508204930), including Admin, Menu, auth/branch+PIN, security, Windows, architecture, quality **ALL SUCCESS**.

**I3 accepted engineering scope:** exact signed 1-micro unit entry and BigInt formatted display, mobile Adjust/Waste with authoritative available stock and scrollable accessible controls, Pending Approval not optimistic posting, retained command ID across retries, append-only one-ledger-event adjustments/waste, changed payload + actor/cross-business/cross-type replay denial, negative stock safeguards, real concurrent-postgres idempotency, and Purchasing-owned `20261025180000_purchasing_command_payload_replay_fence.sql` validated with actual `receive_purchase_order_v1` / `return_purchase_order_v1`, stock balance and weighted cost in disposable PostgreSQL. An initially added duplicate Purchasing RPC migration was deleted; Purchasing's approved authority and SQL remain untouched. Owner UAT/pixel-perfect/production rollout **NOT** accepted.

**Sequential decision:** I3 completed at accepted immutable SHA; **I4 exclusively ACTIVE** (after-shift stocktake begin/save/recover/post, transfer send/receive/cancel and master-bound destinations, reorder, variance, responsive actions, all security and real PostgreSQL tests). Purchasing, CRM, Staff, Finance and Reports implementation locked, preserving valid existing changes. PR #165 remains Draft; no merge, deployment, production migrations or live data mutation. This acceptance note is a later documentation-only HEAD, not a substitute for exact-source testing.

---

## 2026-10-27 Inventory I2 PRE-MERGE ENGINEERING PASS — I3 exclusively unlocked

**Acceptance on exact prior branch HEAD `0e131ed599e2032dea3b6cffa716a49d277216b4`.** All five workflow groups completed SUCCESS (not merely started):
- [Fast CI 40492376652](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40492376652)
- [Six-tab rendered/mobile Chromium 40492376699](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40492376699)
- [Orders isolated PostgreSQL, rendered and production builds 40492376639](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40492376639)
- [P0 Business Day real PostgreSQL 40492376621](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40492376621) (RPC green, conditional irrelevant jobs legitimately skipped)
- [Full monorepo/Chromium + quality gate 40492376657](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40492376657): ALL jobs green including Menu, Admin, quality, Branch/PIN, architecture, security and Windows.

I2 acceptance scope: mobile Add/Edit focus and Close, item create/update/archive/restore, exact micros and zero thresholds, recipe-tracked/manual command payloads, conversion create/update with versioning, duplicate normalized labels denied before POST, stale direct item link read-only, master binding source-unit compatibility across shop-item switches, Owner/Admin composite authority and Manager denial, required shop-local BFF and business-wide master identity boundary. All source edits were confined to Inventory and its E2E. This is **source/CI pre-merge engineering acceptance** and deliberately NOT pixel-perfect or Owner-hosted/physical Production UAT.

**I3 is exclusively ACTIVE**: signed quantity micros, reason codes, approvals, authoritative append-only/idempotent inventory ledger, replay/cross-shop denial, Purchasing consumption and real mobile sheets. I4 and later tabs remain LOCKED. PR #165 stays Draft/open; **no merge, deploy, Production SQL, or mock-data injection**. Source HEAD on which the five CI groups passed is immutable; this ledger-only commit is a later HEAD and does not retroactively change those test results.

---

## 2026-10-27 Inventory I2 continuation — mobile definitions + master integrity, final monorepo gate pending

**Source HEAD for evidence: `035c756a33945e5f17ce7f7def54b08bc7056ac4` (PR #165, Draft). I1 already engineering-accepted. I2 alone is ACTIVE and is NOT yet engineering-accepted; I3/I4 and all later tabs LOCKED.** Owner-authorized hosted / physical acceptance remains deferred until all eight tabs, subsequent separately authorized squash merge, and final testing. No merge, deployment, Production SQL or seeding performed.

**I2 TDD changes (only Inventory and its existing E2E):**
- Mobile 390px Add/Edit focused form **RED** at `3f0ce6e`: Inventory header obstructed editor. **GREEN** `e62447e` Inventory-scoped responsive CSS hides directory header/KPIs only while Add/Edit editor is present, preserves Close context and the fixed shared shell. Rendered Chromium `40481580967` SUCCESS. Actual mobile Add/Edit screenshots artifact `12723431928` inspected.
- Purchase-unit input **RED** at `248562a`: React state updater read `event.currentTarget.value` after event lifetime, conversion form disappeared while typing. **GREEN** `bdc12af`: capture label and quantity value synchronously before state updater. Duplicated purchase-unit labels normalized by trim/case reject before POST at `eb5afcb` (even archived duplicates), while authoritative backend checks remain mandatory. Rendered Chromium `40483932863` SUCCESS after formatting `7056f5e`.
- Six-decimal threshold **RED** at `de17afa`: original micros `9007199254740991` became `9007199254.740992` (one micro higher) in Edit. **GREEN** `6689890`: use already approved BigInt-based `formatPurchaseMicros` instead of Number division inside effect. Rendered Chromium `40485118128` SUCCESS.
- I2 browser commands use trusted BFF and test entity ID, independent optimistic `expectedVersion`, exact zero/micro threshold, no on-hand overwrite, create/update/archive and existing purchase conversion update. Added `item.restore` and `conversion.create` tests on `035c756`, with exact 6-decimal purchase units and role-negative/stale item direct-link coverage. `40491068739` six-tab Chromium **SUCCESS**.
- Recipe master preview **RED** at `e91667d`: selected Rice (g) while preview falsely still showed Beef master (kg) after changing source item; browser `40490140063` FAIL precisely this assertion (123 other tests passed). **GREEN** `6a9e1ed`: clear master selection on item change and derive preview exclusively from compatible unbound recipe masters of exactly matching unit. `40490563737` six-tab Chromium SUCCESS. Backend master GET/POST uses `requireBusinessWidePermission` which enforces OWNER/ADMIN role, composite permissions, shop scope, and CSRF on writes; unchanged.
- Existing role/schema checks, stock ledger idempotency, shop balance RPCs, after-shift-only physical counts and all other tabs remain unchanged.

**I2 source HEAD `035c756` exact runs at this documentation checkpoint:** [Fast CI `40491068726`](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40491068726) all required jobs SUCCESS; [six-tab rendered acceptance `40491068739`](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40491068739) SUCCESS; [Orders isolated PG/browser/build `40491068668`](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40491068668) all SUCCESS; [P0 real PostgreSQL `40491068672`](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40491068672) RPC SUCCESS, conditional jobs skipped. **Full monorepo regression [`40491068657`](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40491068657) IN PROGRESS** at last poll: admin, Branch+PIN, architecture, Windows package and edge-security jobs SUCCESS; Menu and quality browser still in progress. Do not call I2 accepted or unlock I3 until their actual final conclusions are checked. This documentation commit is NOT the evidenced code HEAD.

**Remaining I2 gate:** Recheck Full Regression (all jobs, required gate), changed-file isolation, mobile Add/Edit and master preview UX reference caveats, confirm no actual blocker. If all source gates pass, record formal I2 PRE-MERGE ENGINEERING PASS (not Owner visual/pixel-perfect acceptance) and *only then* unlock I3 (signed micros, approvals, movement append-only/idempotency, inventory-to-Purchasing consumption), using new TDD. No production/integration hosted test yet.

---

## 2026-10-27 Inventory I1 PRE-MERGE ENGINEERING PASS — I2 exclusively unlocked

**Decision at immutable production-source HEAD `78dc195073861d5976d8b239c31e902d0942a892`: I1 source/CI/rendered engineering PASS, not Owner-hosted/physical or exact pixel-perfect release acceptance.** Previous Orders O1–O4 and Catalog C1–C5 premerge source gates preserved. **I2 is the sole ACTIVE implementation task.** I3/I4, Purchasing, CRM, Staff, Finance and Reports LOCKED. The valid historical partial code in later tabs stays untouched. Existing PR #165 remains Draft/open; no merge, force-push, Production migration/deploy, data seeding or real Owner UAT.

**Five exact-source-HEAD workflow groups all SUCCESS:**
- [TUX V2 Fast CI 40477212521](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40477212521): changed-file Prettier/lint, related unit/integration, all impacted typechecks, security contracts, migration chain and required quality gate green.
- [Orders real PostgreSQL/Chromium/build acceptance 40477212526](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40477212526): all three jobs green.
- [P0 Business Day real PostgreSQL acceptance 40477212554](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40477212554): authoritative RPC green; unrelated conditional jobs deliberately skipped, never claimed run.
- [Six-tab rendered Chromium 40477212487](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40477212487): passed all rendered regression including I1 default desktop alphabetical selected row, visible mobile first row, tablet/phone Back, and 390/360 selected inspector/balance arrangement.
- [Full monorepo/Chromium 40477212577](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40477212577): Windows package, architecture, authenticated Branch/PIN, Menu, Admin, edge-security, full quality/browser and required gate all SUCCESS.

**I1 regression and visual evidence:**
- RED 390 list geometry on `5fd7f43`: first list row ended at **815.015625px**, while fixed mobile navigation exclusion began at **772px** in 390×844; screenshot visually concealed stock row. GREEN Inventory-scoped compact heading/actions/tiles/filter CSS at `5fbdb98`, proven at `78dc195` with the same first-row geometry assertion. No global shell changes.
- RED 390 selected inspector on `5ef7cbb`: directory `Inventory` heading still visible above detail; GREEN scoped responsive detail route hides only the Inventory directory header and KPI strip when a mobile/tablet item is active, retaining fixed shop chrome and Back navigation.
- RED 360 mobile balance cards at `37167fb`: three card top coordinates spread **184.75px** vertically. GREEN scoped `inventory-balance-grid` 3-column layout at `78dc195`: top-coordinate delta ≤2px, no body horizontal overflow. All contents still use original authoritative micros/unit and no fake stock meter.
- Artifact `admin-eight-tabs-rendered-evidence` ID **12720309433**, run `40477212487`, includes `test-results/inventory-i1-mobile-390.png`, `inventory-i1-item-detail-mobile-390.png`, `inventory-i1-item-detail-mobile-360.png`, desktop `inventory-i1-desktop-1440.png` and responsive viewport captures. Actual React screenshots inspected against approved inventory 1440/390 list and 390 selected detail references. **Not pixel-perfect**: existing original light Admin shell differs from standalone sample in font/spacing; sample numbers differ from genuine fixtures; item-level action buttons remain above the tabbed facts, while prototype positions them at the bottom. Preserve functional actions, revisit their presentation in I2/I3/I4, and include Owner final mobile visual signoff post-merge; do not counterfeit counts/photos.
- Previous I1 protections remain: real shop-scoped balances/KPIs, archived/unconfigured statuses, exact 6-decimal nonzero quantities, CSV safe labels, desktop sorted row selection, mobile single pane, existing backend history/permissions and off-shift stocktake eligibility; I1 does not change schema, stock or reservation ledgers. Temp formatter diagnostic **deleted**.

**Ruling:** I1 source-engineering acceptance is justified by five exact-HEAD green groups and browser visual/functional evidence, while final authenticated Production and Owner physical acceptance remains expressly deferred until ALL eight tabs are complete and owner separately authorizes squash merge. This ledger-only commit does not retrospectively change evidence at the immutable source HEAD; recheck the branch HEAD for future work.

**Next strict task I2:** Test-first item create/edit/archive/restore + conversion versioning, recipe-master uniqueness and used-in-recipe unit/tracking locks, shop/role denial and stale item editor, 360/390 mobile item editor layout against approved reference. No new I3/I4 work until I2 green.

---

## 2026-10-27 Inventory I1 implementation continuation — selection + micro precision (engineering gate pending)

**Exclusive task:** Inventory **I1**. Orders O1–O4 and Catalog C1–C5 prior pre-merge engineering gates remain unchanged. I2–I4, Purchasing, Customers/CRM, Staff, Finance, Reports LOCKED until I1 is independently accepted. Existing Draft PR #165 / branch `feat/admin-eight-tabs-approved-ui-20261025`. No merge, deployment, Production SQL, or Owner-hosted/physical UAT.

**Latest functional source HEAD before this documentation checkpoint:** `cf3fd58ed6416553535517dbc83a74af1b993dc0`. Do not automatically attribute its CI conclusions to later commits.

- I1 desktop mismatch **RED**: browser test on `1fdb220` provides API rows Beef then Apple while the default sorted visible first row is Apple; rendered Chromium run [40470658841](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40470658841) FAILS specifically because selected row is Beef. **GREEN**: `433610e` selects the first *visible, filtered, sorted page row*, not unsorted API row; cross-tab Chromium [40471072268](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471072268) SUCCESS and Fast CI [40471072236](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471072236) SUCCESS.
- I1 nonzero micros **RED**: unit test on `11ef7d1` repros 1 micro of stock falsely displayed as 0. The related-unit CI job in [40471439301](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471439301) FAILS exactly this new test. **GREEN**: `e252d61` exports a shared quantity formatter that preserves six decimal digits when needed; `cf3fd58` uses it in both the inspector and table, not changing stock amount calculations or backend ledger.
- Latest code-head verified: [Fast CI 40471812650](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471812650) **SUCCESS** (including related unit tests, TS, format, security, migration checks and quality gate); [Orders PG/browser/builds 40471812562](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471812562) **SUCCESS**; [P0 PostgreSQL 40471812374](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471812374) **SUCCESS**; [six-tab rendered Chromium 40471812683](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471812683) **SUCCESS** and captured approved-width screenshot artifacts (ID 12718751881).
- [Full monorepo/Chromium 40471812350](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40471812350) **IN PROGRESS at this checkpoint**: all inspected units/build/security/architecture steps green; Admin and quality browser job not yet finished. Recheck exact job conclusions and correct any failure before I1 acceptance.
- Approved Inventory reference 1440/390 versus actual screenshot reviewed; same basic four-tile / responsive master-detail / single-pane hierarchy, but shell, font, density, and fixture-vs-illustration differences remain. Do not claim pixel-perfect or Owner approval. I1 engineering gate **NOT ACCEPTED YET** pending full regression and final review.

**Next:** Finish latest full regression and exact code HEAD checks; check 1100/768/390 detail/back, shop isolation, selection/query and screenshot evidence; adjudicate I1 source acceptance without conflating it with postponed owner hosted physical UAT. Only then unlock I2.

---

## 2026-10-27 Catalog C1–C5 premerge engineering PASS; Inventory I1 unlock

**DECISION:** At immutable Catalog C5 HEAD `71442e6fb465ebf1473de732af35da2db32f7632`, **Catalog C1–C5 PRE-MERGE ENGINEERING GATE PASS**. Orders O1–O4 previously passed source-engineering gate. Full acceptance of the hosted application is NOT claimed; Owner-authorized final authenticated/physical UAT remains deferred until after all tabs and a separately approved squash merge. Branch PR #165 remains Draft/open; absolutely no merge, Production SQL or deployment.

**Exact-C5 HEAD five green independent workflow groups:** [Fast CI 40467390309](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40467390309) unit/integration/TypeScript/format/security/migrations, [P0 PostgreSQL 40467390304](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40467390304), [Orders real PG + Chromium 40467390203](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40467390203), [rendered cross-tab 40467390401](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40467390401), [Full monorepo/Chromium 40467390411](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40467390411) all SUCCESS. Admin Chromium **320 passed, 19 skipped, zero failed**; publish-specific C5 media/recipe preview browser test at `e2e/admin-catalog-publish.spec.ts:565` GREEN; Menu, security, architecture, quality, authenticated Chromium, Windows packaging all jobs green. Price approvals remain PENDING_APPROVAL without premature publication; version restore/cancel, stale publish, shop isolation, scheduled-auto-run disabled policies preserved. Release preview after RED `91296a2` now distinguishes image add/replace/remove semantically and hides raw storage identifiers, with Version-CAS and recipe relation changed count asserted in E2E. Approved Catalog 12 HTML screenshots were compared progressively in C1–C4 gate records; actual C4 image evidence artifact #12714347223. No invented Catalog fixtures inserted in Production.

**Next single active phase: Inventory I1** (approved text-first Inventory summary/list/master-detail). Inventory I2–I4, Purchasing, Customers/CRM, Staff, Finance and Reports remain LOCKED/NOT ACCEPTED. Preserve their previous valid partial code with no reset/revert. Premerge engineering tests remain mandatory; Owner physical UAT only at end.

---

## 2026-10-27 Catalog C4 pre-merge engineering acceptance / C5 opening

**Verdict: Catalog C4 PRE-MERGE ENGINEERING PASS at immutable `c1448d06109cf4dcab2654599ac9fa41dc17e81f`; only Catalog C5 now ACTIVE.** PR #165 remains open/Draft; no squash merge, deployment or Production SQL. Owner hosted/physical UAT remains expressly deferred to the end after all eight tabs and separately authorized merge; this is not a claim of pixel-perfect production UI or Catalog C1–C5 completion.

**Exact five independent C4 workflows SUCCESS:** Fast CI [40465489573](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40465489573), real P0 PostgreSQL [40465489579](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40465489579), isolated Orders PG/Browser [40465489568](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40465489568), cross-tab rendered acceptance [40465489667](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40465489667), full monorepo/Chromium [40465489605](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40465489605). Admin Chromium job: **319 passed, 19 skipped, 0 failed**. Browser C4 photo-first 390/1440 layout, authenticated file upload, versioned unpublished `imageKey` save/removal, cross-product state isolation and storage failures all green, with existing server signature, MIME, size and shop-scope enforcement tests. Rendered artifact `admin-rendered-e2e` ID 12714347223: `test-results/catalog-c4-editor-photo-1440.png`, `catalog-c4-editor-photo-390.png`, `catalog-c4-upload-mobile-390.png` inspected and compared with approved Catalog reference screenshots 03–06. Remaining native-file-input and overall shared-shell visual styling differences are recorded for final Owner product-wide UI review, not described as a pixel-perfect match.

**C5 next:** independently test all versioned Review & Publish operations (including photo/image and recipe relation diffs), stale draft and approval gating, restore/scheduled semantics and downstream Menu + Operations publication boundary. C1–C4 source-level premerge gates accepted; C5 ACTIVE/NOT ACCEPTED. Inventory, Purchasing, Customers/CRM, Staff, Finance, Reports LOCKED; partial valid work preserved.

---

## 2026-10-27 Catalog C3 — exact-HEAD premerge engineering acceptance

**Decision:** PASS, Catalog **C3 premerge engineering gate** at immutable exact source HEAD `67072d4660583aced9cd35529d7bf98150e6774e`. This does **not** authorize production deploy, migrate, merge, or claim Owner-hosted physical UAT. **Next sequential task C4 ACTIVE only**; C5 + subsequent tabs LOCKED. C1 and C2 prior premerge gates and Orders O1–O4 preserved.

**Five exact-head independent successful CI groups:** [TUX Fast CI 40460625400](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40460625400), [Orders isolated PG/browser 40460625379](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40460625379), [P0 real PG 40460625445](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40460625445), [cross-tab rendered 40460625414](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40460625414), [Full Regression 40460625378](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40460625378), all eight full-regression jobs GREEN; Admin Chromium **315 passed/19 skipped, no failures**. Original 3 confirmed Chromium failures from preceding `4f99b96`: obsolete `More` test expecting implicit draft creation, modal overlay intercepting guard dialog, and navigation guard clicks, now independently green. No regression suppressions or skips added in repairs.

**Evidence:** `admin-rendered-e2e` artifact ID `12714347223` from exact full-run `40460625378` inspected: `catalog-c3-inventory-usage-mobile-390.png` and `catalog-c3-inventory-usage-desktop-1440.png`; compared to authoritative Catalog approved `07-inventory-usage-mobile-390.png` and `08-inventory-usage-desktop-1440.png`. Approved structural behavior reproduced: right 440px product drawer on desktop / full phone sheet, sticky compact header, recipe section without opening More, used/other inventory lines with original units, direct numeric controls, stable focus and a fixed Save draft/Cancel footer. Source data in CI are 1/2 fixture entries, not the 3/12 example in visual reference; do not fabricate production stock. Shared shell and non-Catalog global differences are tracked for final Owner overall visual review, not falsely claimed pixel-perfect.

**Function/security gates:** catalog.view shop-scoped read-only advanced inventory GET, no auto draft on opening product; explicit draft.save only on submit, versioned resumes preserve other saved ingredient links, no silent overwrite; zero/decimal zero unlinks recipe in draft, quantity micros preserved; invalid negative/precision input rejected without mutation; inactive recipe item guard; independent immediate availability.set; shop-isolated back end. Existing Catalog relationships/advanced controls and unsaved edits navigation protections green. Post-publication end-to-end real Menu/Operations propagation and Owner physical UAT remain explicitly deferred to Catalog C5/final release gates, not misreported as C3 completion.

**Owner restrictions:** PR #165 Draft/open; no squash merge, production SQL or deployment. Final hosted/physical checks only after all eight tabs and separately authorized merge.

---

## 2026-10-27 Catalog C2 exact-head premerge engineering acceptance

**DECISION: Catalog C2 PRE-MERGE ENGINEERING GATE PASS at immutable `677f4423bb13617a5921ceec276136471d6ec21e`; C3 now sole ACTIVE tab-task.** Owner authenticated hosted/physical UAT remains explicitly DEFERRED until after all tabs and separately authorized squash merge. This is not acceptance for entire Catalog C1–C5 nor production deployment.

**Exact-head independent five workflow groups SUCCESS:** [Fast CI 40420003422](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40420003422) (unit/integration, format/lint, TypeScript, security, migration checks); [P0 Business Day real PostgreSQL 40420003415](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40420003415); [Orders PG/browser/builds 40420003404](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40420003404); [six-tab rendered 40420003425](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40420003425); [Full Regression 40420003412](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40420003412), with all eight jobs green and **311 Admin Chromium tests PASS / 19 skipped**. Explicit C2 browser tests for mobile/desktop accessible Categories vs Modifiers tabs, desktop four-track grid alignment, single warm Draft banner, no extra Manage shop bar, category create→draft.save→reorder→archive→restore, modifier EGP price draft create/edit, catalog.view-only/can-edit-without-pricing permissions all executed green. Server modifier price permission and stable modifier/product-link reorder regressions and mixed-shop isolation covered.

**Independent actual browser screenshots reviewed:** Full-run artifact `admin-rendered-e2e` #12698200125, `test-results/catalog-c2-categories-desktop-1440.png`, `catalog-c2-categories-mobile-390.png`, `catalog-c2-modifiers-desktop-1440.png`, `catalog-c2-modifiers-mobile-390.png`, `catalog-c2-created-modifier-mobile-390.png`. Compared to approved `09-categories-desktop-1440`, `10-categories-mobile-390`, `11-extras-desktop-1440`, `12-extras-mobile-390`. Core layout, selection, command placement, four columns, mobile compact direct actions, and Draft non-live hierarchy implemented. Approved reference example shows 7 categories/13 extras while the actual test fixture has one category/no modifiers before editing; no fabricated data injected. Shared Admin chrome/overall font metrics differ and are deliberately out of Catalog C2 scope for later Owner product-wide visual review.

**Safety restrictions:** PR #165 remains Draft/open; no merge, deployment, Production SQL, or Owner physical UAT. C1 and C2 premerge engineering source passes only; C3 ACTIVE; C4–C5 LOCKED and Inventory/Purchasing/Customers/Staff/Finance/Reports all not accepted/LOCKED, preserving valid partial code.

---

## 2026-10-27 C2 authorization and modifier-reorder regression checkpoint

- **Pre-documentation HEAD:** `529dd84abd6b2eeea92267229a88f1802faa4ce3`; Draft PR #165 remains open. No merge, deploy, Production SQL or post-merge Owner UAT.
- C2 RED/GREEN desktop table UI, category CRUD, modifier price, view-only/editor-only permission cases implemented in earlier C2 commits and logged above. C2 remains **ACTIVE / NOT ACCEPTED** until all mandatory current-HEAD Browser screenshots, security/functional/backend tests, and independent acceptance pass. Orders O1–O4 and Catalog C1 earlier source gates are not re-opened, but regression checks must remain green.
- New server-side CAT-MGMT-02 regression at `0822521`: `catalogService.saveCatalogDraftChange` must reject a forged modifier `modifiers[].priceMinor` bundle change for a principal with only `catalog.edit`, before invoking persistence. Server pathTouchesPricing and PostgreSQL canonical validation remain authoritative; never trust UI alone.
- New collision-free modifier reorder regression at `529dd84`: preserving `productModifierLinks` while moving two modifiers to sort orders 0/10 through the existing versioned bundle, with no in-place input mutation.
- **Verification pending on new exact HEAD:** Fast CI, Orders PostgreSQL/browser, P0 PG, full Chromium/monorepo and rendered cross-tab workflows. No green claim for these two newest test additions before the job conclusions and logs are reviewed.
- Catalog C3–C5 and Inventory/Purchasing/Customers/Staff/Finance/Reports remain LOCKED / NOT ACCEPTED. Owner-hosted/physical real-app UAT remains deferred until all tasks and independently authorized squash merge.

---

## 2026-10-27 C2 continuation — desktop table parity, transactional CRUD and RBAC checks

**Last independently inspected source HEAD before this ledger commit:** `a088693fd6354c0978d18148fb84a06949924e56` in existing open Draft PR #165. No merge, no Production deployment/SQL. Owner's hosted authenticated and physical UAT explicitly deferred until **after** all eight tabs and a separately authorized squash merge; it is NOT considered passed.

**Gate ledger:** Orders O1–O4 premerge engineering previously PASS; Catalog C1 source-engineering gate passed at `960f941d5520913832dfe1fc4cc18fd12c835fd4` with original evidence. **Catalog C2 is ACTIVE, NOT ACCEPTED.** C3–C5, Inventory, Purchasing, Customers/CRM, Staff, Finance and Reports remain LOCKED/NOT ACCEPTED (later-tab partial source changes preserved, never reverted).

**RED→GREEN work:**
- Existing C2 regression from `e426562`: `getByText('Sides')` was ambiguous between a product-category `<option>` and the real created Categories row. Fixed category Browser locator scoped to active `tabpanel` in `2767ebf`–`27cd748`, preserving the actual versioned draft.save assertion. On exact `27cd748`, Fast CI `40409348812` and isolated Orders `40409348820` succeeded; later HEADs require new evidence.
- Explicit desktop category columns were absent. Unit RED `d984eb7` ([Fast run 40410254951](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40410254951)) failed on missing `data-catalog-definition-columns="categories"`. Implemented Catalog-local `Category / Status / Position / Actions` and `Modifier / Price / Status / Actions` responsive grid at `234ddf9`/`77281c5`; mobile compact rows remain accessible and keep direct move/edit/archive/restore buttons. New 1440px table-column and 390px hidden-header assertions plus screenshots included.
- Added real mocked-API Chromium category create→reorder→archive→restore test asserting collision-free persisted `sortOrder` 0/10, draft only; modifier create EGP 12.50→authorized price edit EGP 15.75 with saved draft snapshots and mobile screenshot; view-only and edit-without-pricing permission controls (latest `a088693`). These are **tests authored, not yet claim of green browser acceptance**.

**Current-head outstanding gate:** Fast TUX CI `40411554639`, full monorepo/Chromium `40411554664`, Orders PG/Browser `40411554893`, cross-tab rendered `40411554807`, P0 PG `40411554701` all need exact-head final conclusions. At ledger write, changed-file style, related unit, and security had passed but suite-wide results were incomplete. Verify desktop 1440 and mobile 390 against approved Catalog refs 09–12 and inspect screenshots/artifacts from final current HEAD, not older captures. Do not close C2 or unlock C3 until modifier/archive/reorder/RBAC/conflict and visual gates all pass.

---

## Catalog C2 focused implementation and acceptance checkpoint — 2026-10-26

**Exact source HEAD inspected before this ledger update:** `6ae034e39d2b9c306f43e5740b11c4e4015f400c`; PR #165 DRAFT/HOLD. C1 premerge engineering passed at immutable `960f941d5520913832dfe1fc4cc18fd12c835fd4` with 5/5 independent green workflows, screenshots 1440/390/360, shop/query/browser checks. That does NOT imply post-merge authenticated physical/Owner UAT, which Owner has intentionally deferred until all tabs are implemented and separately approved squash merge.

**Catalog C2 ACTIVE — NOT ACCEPTED.** First RED `d890a21` demonstrated that Categories and Modifiers/Extras were not separated into accessible tabs; source-level GREEN component, keyboard/disclosure-friendly tab-state and editor-preservation tests were implemented. C2 E2E tests cover 390px switching and form guard, 1440px tabs, four screenshots, and category create→versioned draft.save without publishing. Defensive isolation RED at `0d075d8` showed an other-shop Category leaking through a mixed editor payload; fix `825af69` scopes both list collections to concrete `shopId` before display and mutation. A 60-second failed Chromium category-create test artifact from earlier `88fdc35` revealed the root cause: React `event.currentTarget` became null inside the deferred state updater, crashing the entire Admin after a form input. All five definition form onChange handlers now synchronously capture values, with Prettier repair at `2fbb477`. This failure is NOT accepted until the same Chromium create/save flow passes.

**Actual browser screenshot differences** at older `88fdc35` against approved `09–12`: while tabs now switch correctly, Manage still showed unrelated product controls, doubled Draft banners, and visually concatenated/unformatted row content. RED visual contract test at `d1c44d6`; Catalog-only changes through `6ae034e` implement focused Back toolbar, single Draft guidance, compact local definition rows/accessible actions and green Add controls, preserving the underlying real draft operations.

**Latest CI:** Fast TUX V2 CI [40390327177](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40390327177) **SUCCESS at `6ae034e`**, including formatting, related unit/regressions, TypeScript, security and migration checks. Business Day Postgres [40390326953](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40390326953) success. Independent Orders [40390327225](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40390327225), full monorepo/Chromium [40390327045](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40390327045), cross-tab rendered [40390327069](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40390327069) still pending/in progress at last inspection; do not inherit results after this docs HEAD changes. New exact-head screenshot comparison and category create/save browser validation required.

**Remaining C2:** robust create/edit/archive/restore/reorder and same-shop version conflict/security checks; modifier price permission/saving; actual 1440/390 category+extras visual review; green exact-head complete suite. C3–C5 and Inventory/Purchasing/CRM/Staff/Finance/Reports remain LOCKED and NOT ACCEPTED. No production migration, deployment, merge or post-merge UAT during this branch.

---

## 2026-10-26 — Catalog C1 exact-head engineering acceptance

**Decision: C1 PRE-MERGE ENGINEERING GATE PASSED at immutable `960f941d5520913832dfe1fc4cc18fd12c835fd4` only.** This decision covers Catalog C1 Product Directory/search/selection/mobile actions, not C2–C5, not entire Catalog, and not deferred Owner/hosted physical UAT. C1 RED→GREEN category-bar structural regression and 390px primary action width regression are green at this exact head. Product data, image-key authorized thumbnail GET and stock/status remain trusted shop-scoped sources; search/status/category filters, selection navigation, unsaved draft, shop switching and live vs draft actions are browser-tested.

**Five independent workflow groups on exact head SUCCESS:** Fast CI `40354746700` (format/lint, TypeScript, 118/118 related tests and security), isolated Orders financial PG/Chromium/full build `40354746687`, Business Day real PostgreSQL `40354746901`, six-tab rendered acceptance `40354746780`, full monorepo `40354746801` (2433/2433 root unit tests, 302 passed/19 skipped Admin Chromium, complete run green). Screenshot artifact `admin-rendered-e2e` #12665223058 carries `test-results/catalog-c1-products-desktop-1440.png`, `catalog-c1-products-mobile-390.png`, `catalog-c1-browse-360.png`, `catalog-c1-browse-768.png`, `catalog-c1-browse-1024.png`; independently opened 1440, 390 and 360 screenshots. The visual hierarchy, full-width mobile management actions and separate category bar now match core approved Products layout. Recorded differences: approved sample has 49 items and draft banner, test fixture has 12 and no draft; global Admin shell/nav branding and visual density differ, not adjusted in C1 because these are cross-tab shared design; Owner final visual acceptance remains POST-MERGE UAT DEFERRED.

**Sequential unlock: C2 Categories & Modifiers/Extras is the sole ACTIVE implementation task.** C3–C5 and Inventory/Purchasing/CRM/Staff/Finance/Reports remain NOT ACCEPTED/LOCKED. Keep PR #165 open/draft; no production migration, deployment or merge.

---

## C1 390px mobile toolbar visual defect — 2026-10-26

- **Actual React browser visual evidence at immutable `cd022d2823efe96268d83db1fe2a9461c75f43ab`:** [Admin E2E 40352161947](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40352161947), artifact `admin-rendered-e2e` ID `12665520467`, `test-results/catalog-c1-products-mobile-390.png` and desktop 1440 / 360 / 768 / 1024. Against the original approved `02-products-mobile-390.png`, the two Catalog header actions were shrink-wrapped to roughly 242px each, leaving unnecessary empty space; the reference stretches both full available content width. This is a C1 actual rendered UI difference, not a mocked feature requirement.
- **Regression written:** `e2e/admin-catalog.spec.ts` at `1a243749c81481b504921d38f75b8f37b2abad27` requires both rendered 390px action widths >=330px and consistent widths. The previous screenshot establishes the failing visual baseline; **do not claim that this specific new automated test ran RED unless its job log explicitly demonstrates the failure**.
- **Smallest Catalog-owned production fix:** `apps/admin/src/catalog/catalog.css` at `010d82ba08c06a80c79be42067bad1d158ab848b` overrides the shared PageScaffold `align-self:flex-start` only when its direct child is Catalog's action toolbar, within phone breakpoint. Underlying shared layout, other tabs, shop scopes, permissions and commands are untouched.
- **Status: C1 ACTIVE, NOT ACCEPTED.** New exact-HEAD Fast CI, Catalog Chromium including width assertion and actual 390 screenshot, Orders/PG, cross-tab and full monorepo regression must all finish green. Compare 1440 and 390 with approved screenshot; do not advance C2 before mandatory evidence. Owner physical/hosted UAT remains deferred until after all tabs, approved squash merge and real-app acceptance; no production deploy, SQL or merge now.

---

## Catalog C1 visual hierarchy RED→GREEN checkpoint — 2026-10-26

- **Inspected branch HEAD prior to documentation:** `41102914ea80f170303507510691974b44b76a3e`, Draft PR #165. Do not equate this checkpoint with current-head CI acceptance; future commits require fresh checks.
- **Owner release policy:** Orders O1–O4 pre-merge engineering gate passed earlier; hosted physical Owner testing is **POST-MERGE DEFERRED**, not silently complete. Catalog C1 exclusively active; C2–C5 and all remaining tabs locked. No main merge, Production SQL, production deploy or authority/permissions changes.
- **Defect proven against approved Catalog 1440/390 screenshots:** category shortcuts were nested within the rounded/bordered Products directory instead of in their own horizontal band directly above it. This made the Catalog visual grouping differ from the approved screen.
- **RED:** Added regression `apps/admin/src/catalog/p02CatalogBrowse.test.tsx` at `8519c4f`. GitHub Fast CI run [40350641584](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40350641584), unit job `121669542389`: test `C1 keeps category shortcuts outside the bordered products directory` **FAILED as expected** with `expected 0 to be greater than 335`; 117 companion tests passed. This is an intentional RED test checkpoint, not a completed source gate.
- **GREEN candidate:** `ee9264c` refactored `ProductList.tsx` to place category navigation outside the bordered section while keeping the query/status/category controls and existing `data-catalog-list` selector; `1bda610` introduced Catalog-only CSS grid/gap with aligned category navigation; `f1e3357` corrected Prettier-sensitive JSX wrapping. Unit, formatting, TS, security, actual rendered Chromium, Orders/PG and cross-tab regressions **must be inspected at the current final HEAD** before C1 closure. Later Catalog viewport screenshot tests may be present in subsequent commits and are pending independent evidence review.
- **Next action:** inspect exact-head Fast CI, full regression, rendered browsers and responsive 360/390/768/1024/1440 approved visual comparisons. Fix any failures RED→GREEN. Then document each C1 requirement acceptance with screenshots; do not begin C2 prematurely.

---

## Owner-authorized pre-merge implementation gate / postponed physical UAT — 2026-10-26

**Owner's revised authoritative release decision:** complete ALL EIGHT TABS and their source-level functional, backend, security, responsive Chromium and cross-app contract tests **sequentially** on Draft PR #165. The previous requirement to obtain exact-SHA **hosted/physical Admin + Menu + Operations end-to-end UAT and final Owner phone visual signoff before leaving Orders is rescinded** for the implementation sequence. Those tests and final visual/physical acceptance are explicitly **DEFERRED UNTIL AFTER all tasks are completed, Owner separately approves a squash merge to main, and post-merge real-app testing begins**. Any post-merge defects will be corrected in subsequent PRs; no present completion claim substitutes for that physical test. Never merge automatically.

**Pre-merge requirements are NOT waived**: fully implement the current tab; verify targeted and full typecheck/format/lint, real disposable PostgreSQL, security/RBAC/replay, responsive running React screenshots, and available cross-app API/contract tests; independently review actual evidence and document differences. Do not advance if implementation, automated tests, or security is failing.

**Orders O1–O4:** PRE-MERGE ENGINEERING GATE **PASSED** on exact source `9b5f48d67b6a57f73a26d163b9e4882ad6cc398d`: four green independent CI workflow groups (40270793434; 40270793470; 40270793509; 40270793423), Orders 33/33 Chromium, six-module 112/112 Chromium, real PG refund/PIN/RBAC assertions, dev Orders/Finance same-shop aggregate equality, 1536/390 responsive screenshot artifacts. Not pixel-perfect: old shell/fixture-dense reference differences and no Owner-selected mobile screenshot recorded below. **POST-MERGE HOSTED/OWNER VISUAL/PHYSICAL ACCEPTANCE DEFERRED, NOT PASSED.** Engineering may now advance to Catalog.

**Catalog C1 source work ongoing (NOT ACCEPTED yet):** initial approved browse contract RED test in `apps/admin/src/catalog/p02CatalogBrowse.test.tsx` produced exact expected failure at `6195934a95c370d4c05bbf7b8b7de2875cf5dfc2` (Fast CI job 121405158147). Implemented in `ProductList.tsx` genuine shop-scoped category counts/shortcuts, desktop four factual columns, mobile readable row/card, accessibility and Reset; responsive CSS in `catalog.css`; added `e2e/admin-catalog.spec.ts` desktop 1440/mobile 390 workflow/screenshots. Latest implementation source before this ledger-only commit: `7a240cf7f23fcb23e3836f6a0d26985905e0dbe5`. CI GREEN and selected visual review must be independently verified before C1 closes. No C2–C5 work yet.

**Strict sequence:** Orders (pre-merge engineering gate PASSED; physical UAT DEFERRED) → **Catalog C1 ACTIVE, C2–C5 LOCKED** → Inventory partial/locked → Purchasing locked → Customers/CRM partial/locked → Staff partial/locked → Finance partial/locked → Reports partial/locked. No newer tab considered accepted. No production deployment, main merge, production SQL or owner signoff implied by this change.

---

## 2026-10-26 — Orders-only continuation, exact hosted Preview and PIN/Finance evidence

**Single active tab remains Orders O1–O4.** Catalog, Inventory, Purchasing, CRM, Staff, Finance and Reports are preserved but NOT ACCEPTED and must not be expanded until Orders' final H/V gates close. Existing Draft PR #165 stays OPEN / DRAFT / HOLD. No Production migration, merge, promotion, or deployment.

**Verified source test baseline before this continuation:** commit `8fbc33d419c14148d9a882d2e82add45cdced2bd`; four exact-commit Actions groups SUCCESS: TUX V2 CI run `40245934344`, Orders isolated PostgreSQL/full regression/Chromium run `40245934338`, multi-tab regression `40245934328`, Business Day PG `40245934346`. Orders rendered browser job `121327373170` passed **32/32** at that exact SHA.

**Hosted Preview creation (not Production):** Created a protected Vercel Admin Preview from that SHA, deployment `dpl_De5gVbjf6WkRGcLYtFaAWK5fAvLm`, URL `https://tuxcasheirnew-admin-kedshqzrl-ahmed-s-projectssasa.vercel.app`. Independently inspected deployment as `READY`, git SHA `8fbc33d...`, `target=null`, security/SSO left enabled. This is deployment evidence only. It does not establish successful PIN login or Operations/Menu/Finance transaction parity. If PR HEAD changes from tests/docs, this Preview is no longer **exact HEAD**; do not silently claim matching-sha UAT.

**Read-only TUX V2 development Supabase cross-module financial reconciliation:** 2026-10-25 Cairo business day, one shop independently authorized for both `orders.view` and `finance.view`; direct `admin_orders_kpis_v1` returned `ok=true`, **5 orders, 106000 minor (EGP 1,060.00)**, and direct `admin_finance_report_query_v2` returned `ok=true`, **5 orders, 106000 minor** with 5 finance events. The persisted database independently contains 5 orders, 5 payments and 0 POSTED refunds. The same saved-order population agrees in Orders and Finance database functions; no new test records or schema changes applied. This is **P: PASS for cross-module database parity**, **H: NOT VERIFIED** for actual hosted POS checkout, Menu acceptance and application UI.

**O10 source negative-data leakage regression:** New `e2e/admin-orders.spec.ts` Chromium test executes actual Admin cancellation UI against isolated mock HTTP endpoints; verifies the reauthentication route receives PIN in its exclusive request, while Orders command payload omits PIN and no PIN is left in browser localStorage/sessionStorage or the application console. Initial test code commit `3f7ebc1...` passed the dedicated Orders rendered browser job `121401947254` but failed changed-file formatting; exact Prettier wrap `c392c13...`, diagnostic workflow removed `6b731649...`. **Do not declare exact latest source HEAD green before fresh CI finishes.** The test is a mock-auth security regression, not proof that live SSO/remote application logs never contain a PIN. Full hosted O10 negative audit remains open.

**Orders phase disposition:** O1/O2/O3 source, isolated Postgres, responsive browser and financial tests substantially verified; O4 still requires a same-revision protected Admin + Operations + Menu hosted session, actual POS and ONLINE checkout/acceptance into the same Supabase database, Admin read/updates and Finance/Reports reconciliation, plus Owner-selected desktop and new mobile visual approval. **No Orders or following tab marked complete.**

## Orders-only resumed implementation: exact-HEAD verification and development SQL audit — 2026-10-26

**Inspected branch:** `feat/admin-eight-tabs-approved-ui-20261025`, Draft PR #165 at **`8fbc33d419c14148d9a882d2e82add45cdced2bd`** before this documentation checkpoint. Compared to `da2c308a604bf8c98329c3581615c57f6e4a587d`: **one ledger-only commit**, no source changes. Prior workforce formatting failure is closed by fresh exact-head Fast CI job `121327409132` SUCCESS; do not reopen frozen Staff work.

**Four actual exact-HEAD workflow results:**
- [Fast CI 40245934344](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245934344): changed paths, formatting/lint, unit/integration, typecheck, security contracts, migration chain and required quality gate **SUCCESS** (Edge check skipped by scope).
- [Orders isolated acceptance 40245934338](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245934338): Orders real PostgreSQL financial RPC, full source regression/production builds and rendered Admin Chromium **SUCCESS**; screenshot archive artifact [orders-rendered-evidence](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245934338), ID `12617734803`, SHA-256 `078183249fc109f18eaceb38a335b090286eeb77c59412d972c2befc7030294c`.
- [Cross-module rendered acceptance 40245934328](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245934328): six modules' Chromium regression **SUCCESS**; this is not acceptance of frozen later tabs.
- [Business Day PostgreSQL 40245934346](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/40245934346): real RPC **SUCCESS**, unrelated inventory tasks skipped by scope.

**Remote DB, read-only rechecked now:** Connected account `TUX V2 And masjid`, actual TUX V2 project `awpdcsayuwbsruwvaosg` ACTIVE_HEALTHY. Existing migration `20261025221507 orders_authoritative_kpis` recorded exactly once. PostgreSQL `public.admin_orders_kpis_v1(uuid,uuid,timestamptz,timestamptz)`: `anon EXECUTE=false`, `authenticated EXECUTE=false`, `service_role EXECUTE=true`. RLS enabled on `public.orders`, `public.payments`, `public.admin_order_refunds`. **No migration re-applied and no remote writes performed in this checkpoint.** Prior independent development aggregate and disposable 67-order/PostgreSQL refund proof remain recorded below.

**Hosted Preview investigation:** exact-source Admin Vercel Preview deployment `dpl_De5gVbjf6WkRGcLYtFaAWK5fAvLm` for `8fbc33d...` exists; it was still **BUILDING** when inspected (target Preview, never Production). Earlier Preview `dpl_vyVCZC4cXBZukPyNEEfPR1k9j8xc` is READY but belongs to source `dc135ee1...`, and is SSO-protected. No same-SHA authenticated Operations/Menu/Admin/Finance transaction or negative PIN log/storage trace has been observed. Do not bypass SSO or count Vercel READY as hosted business acceptance.

**Strict sequential task ledger — acceptance status, not commit existence:**

| Tab/task | Current disposition | Remaining acceptance |
| --- | --- | --- |
| Orders O1 | SOURCE/CI PASS; **NOT FINAL ACCEPTED** | Authenticated hosted filter/deep-link proof; desktop Owner signoff |
| Orders O2 | SOURCE/DEV DB/PG PASS; **NOT FINAL ACCEPTED** | Same live placed/refunded order reconciliation through Operations/Menu/Admin/Finance/Reports |
| Orders O3 | SOURCE/PG/Chromium PASS; **NOT FINAL ACCEPTED** | Hosted protected PIN/reason/second-person negative action trace |
| Orders O4 | Browser responsive/visual captures available; **NOT FINAL ACCEPTED** | Owner 1536 desktop and 360/390 mobile visual acceptance; matching-source hosted cross-app transaction |
| Catalog C1–C5 | **NOT ACCEPTED / LOCKED** | No new features until all Orders acceptance |
| Inventory I1–I4 | **PARTIAL PRE-EXISTING / LOCKED** | Full independent functional/backend/security/visual acceptance at its turn |
| Purchasing P1–P4 | **NOT ACCEPTED / LOCKED** | Full independent acceptance at its turn |
| Customers/CRM CRM1–CRM4 | **PARTIAL PRE-EXISTING / LOCKED** | Full independent acceptance at its turn |
| Staff S1–S4 | **PARTIAL PRE-EXISTING / LOCKED** | Full independent acceptance at its turn |
| Finance F1–F5 | **PARTIAL PRE-EXISTING / LOCKED** | Full independent acceptance at its turn |
| Reports R1–R5 | **PARTIAL PRE-EXISTING / LOCKED** | Full independent acceptance at its turn |

**Current task:** Orders O4/O10/O11/O12 hosted and Owner acceptance evidence. **Release disposition:** HOLD, Draft PR; no merge, no production deployment, no Production SQL; advance to Catalog **only after** explicit Orders acceptance. The exact-source CI SHA above is not automatically transferable to the documentation commit this entry creates.

---

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

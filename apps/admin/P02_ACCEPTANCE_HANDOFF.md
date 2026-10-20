# P02 — Catalog & Settings Independent Acceptance Evidence

**Release state:** DRAFT PR #125. No squash merge authorization. Scope: Admin P02 only.

**Baseline:** `fc9bb856f44bf6392075718a672054a6935f5490` (P01 approved).
**Verification target:** latest `feat/admin-premium-p02-catalog-settings` PR HEAD. Record and compare against GitHub Actions exact-HEAD before approval.

## Finding-to-implementation traceability

| Finding | Implementation evidence | Regression/browser evidence | Disposition |
|---|---|---|---|
| TUX-007 | `catalog/catalog.css` browse/editor exclusivity, full-width editor; `CatalogPage.tsx`, `ProductList.tsx` | `p02CatalogBrowse.test.tsx`; `e2e/admin-catalog.spec.ts` browse/editor across viewports | Implemented; exact-HEAD final review required |
| TUX-008 | `ProductEditor.tsx` live availability notice and separately confirmed draft archive | Unit editor tests; Catalog Playwright command assertions | Implemented; approval pending |
| TUX-009 | `ProductEditor.tsx`, `ProductInspector.tsx`, `catalog.css` progressive disclosure and full-width task surface | 320/375/390 responsive editor/modifier screenshots | Implemented; owner visual review pending |
| TUX-010 | `CatalogDefinitionsEditor.tsx` per-record actions in keyboard-operable details | 320/375/1440 definitions and actions screenshots | Implemented; review pending |
| TUX-031 | `SettingsPage.tsx` separate Publish configuration disclosure and PIN | `SettingsPage.test.tsx`, publish + pending approval browser flows | Implemented; review pending |
| TUX-032 | `ShopsPage.tsx` focused Identity, Hours, Immediate controls, and Danger zone | Lifecycle approval/deletion mocked browser regressions + confirmation screenshots | Implemented; review pending |
| TUX-033 | `ShopCopyPreviewPanel.tsx`, `CatalogCopyPanel.tsx` authorized metadata labels, raw IDs only in technical disclosure | Settings/Catalog copy previews and trusted RPC tests | Implemented; verify name authorization in Owner UAT |
| TUX-034 | `ShopsPage.tsx`, `settings.css` focused sections instead of an uninterrupted long form | Six viewport sizes + shop hours/danger/operations captures | Implemented; owner mobile walkthrough pending |
| TUX-035 | `SettingOverrideEditor.tsx`, `settings.css` distinct configured value and draft action guidance | `SettingsPage.test.tsx`, checkout/receipts E2E and defaults screenshots | Implemented; review pending |

## Exact-head evidence gates

- Workflow `.github/workflows/admin-p02-visual-evidence.yml` checks out the pull request's exact head SHA and runs Chromium Playwright against isolated mocked Admin API endpoints.
- The workflow requires **115 screenshots**, at **1440, 1280, 768, 390, 375, 320** CSS widths. PNG bytes are SHA256-hashed in `artifacts/p02/SHA256_MANIFEST.json`; both ZIP and manifest are uploaded as the `p02-chromium-evidence` artifact for that run.
- Examine the complete exact-head workflow list: root CI; Admin Foundation; Catalog Settings; Workforce; Finance; UI/UX Hardening; P02 Chromium Visual Evidence. Any failure or pending job means NOT READY.
- Scope assertions: `git diff main...HEAD` must include **no** Supabase migration, SQL, Edge Function, Operations/Menu code, logo asset, token baseline, or backend authorization changes.
- Capture methodology proves mocked Chromium UI, **not authenticated hosted UAT**, and does not prove Shop A/Shop B data has remained unchanged outside this PR.

## Business-data and security boundary

No production catalog copy, publish, sell-out, archive, pause, tax/payment change or shop lifecycle command is executed as part of the captured fixtures. Live data were not modified by this PR. Shop A seeded data and QA Shop B are protected by avoiding application mutation and any Supabase write; read-only production integrity comparison remains an independent Owner verification. Existing PIN, shop scope, RLS, approval, CAS and publication semantics are not edited in this frontend-only diff.

## Remaining Owner/Planner UAT

Independent Owner and Planner should inspect selected viewport images, actual hosted authenticated Owner and restricted Manager routes, keyboard and native zoom/screen-reader ergonomics, real shop labels, actual save/publish/approval behavior **without mutating production data**, and explicitly authorize any later merge. P03–P07 and Plan 8 remain out of scope.

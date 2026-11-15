# TUX Admin — UI/UX rendered Playwright audit (2026-11-15)

## Scope and evidence discipline

- Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`, baseline commit `98e4e65a7076a425055bd20286a80069a1f16c78` (main).
- **UI / UX only.** No runtime application files, API behavior, migration, production database, permissions, or real shop records were modified.
- Testing uses compiled Admin and synthetic/mock-auth fixture data in an isolated browser. This is **not** a signed-in production Owner session. A separate `@playwright/mcp@latest` JSON-RPC session successfully navigated the actual public Admin origin and captured its unauthenticated login.
- Local full Admin Playwright execution: **527 collected; 497 passed, 11 failed, 19 skipped**. The earlier scoped run of 189 targeted cases passed 189/189 when targeted extra captures were disabled.
- Screenshots available: **786 PNGs**, comprising 645 test-results images (including failure screenshots), 84 six-width baseline images, 56 targeted viewport images, and one MCP live-login image. Screenshots are end-of-test frames or explicit in-test states; **not every button and nested dialog was guaranteed photographed or manually clicked**.
- GitHub Actions workflow: [audit PR #177](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/pull/177) / [evidence run #43681476450](https://github.com/ahmedmohameda7222-ship-it/TUXCASHEIRNEW/actions/runs/43681476450). Artifact: `tux-admin-ui-ux-visual-evidence` (about 107.5 MB, 30-day retention).
- Temporary browsable gallery: [all screenshots](https://sb-6ma4hfur3tsb.vercel.run/artifacts/admin-ui-ux-audit/index.html); [ZIP download](https://sb-6ma4hfur3tsb.vercel.run/artifacts/admin-ui-ux-audit/screenshots.zip); [test log](https://sb-6ma4hfur3tsb.vercel.run/artifacts/admin-ui-ux-audit/full-run.log). Temporary URL is valid only while audit sandbox lives.
- Workflow status is intentionally **failure**, because it ran the current tests and preserved real failing evidence rather than suppressing it.

## Observed failed tests — actionable triage

| Priority | Area / viewport | Evidence | Interpretation and action |
| --- | --- | --- | --- |
| P1 to investigate | **Inventory** 390px, light/dark, cold/warm (4 cases) | `e2e/admin-inventory.spec.ts:1419`; `e2e/premiumVisualEvidence.ts:162`; `apps/admin/src/inventory/inventory.css:294-319`; `InventoryPage.tsx:372-415` | Geometry assertion finds `<button>Reorder suggestions</button>` outside viewport. Check whether More actions is closed/visually hidden when measured; distinguish actual **visible** clipping from a geometry false positive. If visible when menu opens, constrain popover to viewport and use appropriate mobile disclosure/sheet, while preserving all handlers. |
| P1 to investigate | **Reports** 390px, light/dark, cold/warm (4 cases) | `e2e/admin-reports.spec.ts:389`; `e2e/premiumVisualEvidence.ts:162`; `apps/admin/src/reports/ReportFilters.tsx:150-165`; `reports.css:236-265` | Geometry assertion finds partially offscreen `<button>Customers</button>` inside **intentionally horizontally scrollable** `.tux-report-quick`. Treat as an **accessibility/discoverability review**, not proof of page-level overflow. Verify horizontal affordance, keyboard focus / scroll-into-view, and whether the test should exempt intentionally scrollable tab strips. |
| P1 test/UX follow-up | **Purchasing / Suppliers** 768, 390, 360px (3 cases) | `e2e/admin-purchasing.spec.ts:1056-1080`; `apps/admin/src/purchasing/SuppliersPage.tsx:205-285` | Test times out on `getByRole('button', {name:'Archive Prime Foods'})`; accessibility snapshot shows the supplier row but no accessible Archive action. The selected supplier inspector supports `is-mobile-collapsed`, and action renders only when `canManageLifecycle` and version are valid. Check whether test must explicitly expand supplier first and whether mobile action discoverability is sufficient. **Do not change authorization or archive behavior to make test green.** |

The 11 failures are **three clusters, not 11 independently diagnosed product defects**. Retest on stable local preview before shipping any UI-only fixes. Do not confuse a viewport bounding-rect assertion with a user-visible defect without confirming parent clipping/scroll context.

## Visual and UX review by primary Admin area

| Area | What to review / proposed UI-only change | Confidence |
| --- | --- | --- |
| **Home** | Preserve decision-first shop status and daily KPIs; visually separate urgent attention from descriptive metrics and make shop scope/data recency prominent. | Design recommendation, mock screenshots |
| **Orders** | Replace exposed internal term `Canonical orders` with clearer label while retaining exact underlying selection semantics; clearly distinguish confirmed orders vs online requests. Improve filter grouping and selected-order inspector scan path. | Source + rendered screens |
| **Catalog** | Prioritize New product and Review & Publish; visually distinguish saved draft, approval pending, and currently published state. Reduce visual competition between Bulk Edit and Manage categories/extras. No publishing logic changes. | Source + 61+ captured catalog/publish cases |
| **Inventory** | Clarify top action priority (Stock count, Add item, Export CSV, More actions). Use task-based grouping in More actions; inspect 390px menu popover clipping; consolidate repetitive inspector settings metadata. | Confirmed geometry test cluster + rendered screenshots |
| **Purchasing** | Make supplier-selection-to-edit/archive journey explicit in tablet/mobile master-detail. Keep named archive confirmation and version authority unchanged; recheck timed-out tests. | Test failure + source |
| **Delivery** | Clarify workflow of delivery zones vs riders vs assignments; maintain current action semantics. Verify small-screen task visibility and empty states. | Screen captures / test suite |
| **Customers / CRM** | Master/detail inspector and segment/merge sections contain dense information; improve heading hierarchy and separate identity from activity/actions on narrow screens. | Rendered screenshots |
| **Staff** | Four-step Add employee sheet (identity, shops, employment, review): improve progress and validation placement, especially PIN/approval and partial onboarding states; preserve resume/approval logic. | Source + extensive workforce E2E suite |
| **Finance** | Keep account balance vs account movements visually distinct; use consistent currency alignment, financial labeling and status language across sections. | Rendered finance views |
| **Reports** | Review horizontally scrollable quick-report selector and its truncated Customers tab on 390px; give clear scroll affordance and/or alternative chooser, and avoid heavy filter/UI density. | Confirmed geometry assertion + visual context |
| **Alerts** | Present severity, freshness and affected shop before low-priority metadata; make next action discernible. | Rendered mock tests |
| **Devices / Operations** | Separate health dashboard from Devices, Printers, Opening/Closing and Manager Log in way users can navigate without losing scope. | Router + mock suite |
| **WhatsApp** | Ensure disabled / pending automation is explicitly worded, conversations read-only when appropriate, and status colors have text equivalents. | Suite + source |
| **Settings** | Keep Save vs Publish distinct and publication authority visible near settings being edited; show unsaved/pending status before leaving section. | Source + Settings E2E tests |
| **Approvals & Approval rules** | Show pending vs approved/rejected, requester and action context; avoid ambiguous disabled CTAs. | Mock browser tests |
| **Audit Log** | Preserve trust-oriented immutable data; improve filtering, timestamp readability, and links into related records without altering audit events. | Source / approval-audit tests |
| **Navigation / Mobile More / Login** | Maintain grouped desktop navigation, bottom mobile nav, focus states, responsive overflow and permission-limited access. Review consistency across 320, 360, 390, 768, 1024, 1440, 1536 widths. | Browser suite / captures |

These design recommendations are not claims that the current UI is functionally broken. Screenshots show existing responsive structure in many cases, but not a completed human-judgment test of every user workflow.

## Proposed UI-only work order (one area per PR)

1. **Triage responsive clipping**: Inventory 390px `More actions` and Reports 390px quick-report selector. Verify actual visual condition before CSS patch; update Playwright checks to distinguish intentional nested scroll from accidental page clipping.
2. **Purchasing workflow inspection**: reproduce selection -> expanded inspector -> archive on 360 / 390 / 768. Fix action discoverability using presentation only if necessary. Do not bypass approvals.
3. **Shared UI patterns**: action hierarchy, spacing, typography, contrast, button styles, focus indicators, loading/error/empty states, dialogs/sheets. Keep existing TUX design tokens.
4. **Area-by-area UX**: Catalog publish clarity; Orders state labels; Staff onboarding; Customers detail; Reports filters; Inventory actions. Do **not** modify unrelated tabs together in one implementation PR.
5. **Owner-authenticated UAT**: separate browser walkthrough against the real deployment with user-authorized authenticated session. The current audit has no authenticated production screenshots; do not assert otherwise.
6. **Regression gate**: every UI PR must pass `npm run build:admin`, typecheck, relevant Playwright suite, and 320/360/390/768/1024/1440 viewport captures. Keep logic/API/database differences empty.

## Hard constraints for implementation

- No changes to domain/business logic, validation, permission checks, API contracts, DB schema/migrations, publishing semantics, sync, order lifecycle or financial calculations.
- Do not access, mutate or reset live data while taking screenshots.
- Do not weaken tests simply to silence the 11 failures. Diagnose visibility vs scroll first.
- Preserve route compatibility, keyboard navigation, aria names, confirmation dialogs and approval/PIN flows.
- Leave PR #177 draft; audit workflow/report are not product changes and should not merge automatically.

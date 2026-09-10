# TUX Admin Implementation Plan Self-Review

**Reviewed spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

**Reviewed plan set:** master plan, ten numbered domain/reliability plans, `2026-09-10-tux-admin-plan-hardening.md`, and `2026-09-10-tux-admin-spec-coverage-hardening.md`.

**Purpose:** Record the required writing-plans self-review before any application implementation begins. This document is evidence about plan coverage and consistency only; it does not claim that the planned software/tests are implemented or passing.

## 1. Specification Coverage Matrix

| Spec section | Implementation-plan coverage | Review result |
| --- | --- | --- |
| 1. Purpose and product goal | Master plan + all domain plans | Covered |
| 2. Existing production architecture | Master; Foundation/Auth; Reliability | Covered; one canonical Supabase preserved |
| 3. Product authority boundaries | Master; Orders; WhatsApp/Operations; Reliability | Covered; Admin is management plane, Operations remains live execution authority, Menu remains customer-facing |
| 4. Approved technical architecture | Foundation/Auth; Master; Reliability | Covered; `apps/admin` + same-origin trusted BFF + canonical backend |
| 5. Business and multi-shop model | Foundation/Auth; Catalog/Settings; Customers; Workforce | Covered; business-level identities with shop-specific operational state/overrides |
| 6. Design system and adaptive UX | Foundation/Auth/Shell; Approved-Scope Completion; Spec-Coverage Hardening accessibility task | Covered; Apple-HIG-guided, mobile-first, adaptive, light/dark/system |
| 7. Navigation and application shell | Foundation/Auth/Shell | Covered; phone bottom navigation, tablet/desktop adaptive shell, permission-aware destinations |
| 8. Admin authentication, roles, permissions, re-auth, approvals | Foundation/Auth; Approvals/Audit; Plan Hardening; Spec-Coverage Hardening Task 1 | Covered after hardening: PIN-only, first OWNER bootstrap, stable permissions, throttling, sessions, generic acting-user re-PIN, second-person approval |
| 9. Dashboard, reports, alerts, targets, owner summary | Finance/Reports; Approved-Scope Completion Tasks 1–2/6; Reliability; Spec-Coverage Hardening Task 6 | Covered; role-adaptive dashboard, saved/report views/targets, deduplicated alerts, owner summary, push |
| 10. Catalog, pricing, availability, publishing | Catalog/Settings; Approved-Scope Completion Task 3; Reliability Task 5 | Covered; master compatibility layer, shop overrides, draft/preview/atomic publish, immediate availability, images, bulk actions, versioning, scheduling, concurrency |
| 11. Inventory and recipes | Inventory/Purchasing; Plan Hardening Task 3; Spec-Coverage Hardening Task 2 | Covered; existing inventory extended, units, ledger, reservation lifecycle, costing, stocktake, transfers, par/reorder, theoretical-vs-actual, explicit OWNER emergency override |
| 12. Purchasing and suppliers | Inventory/Purchasing; Approved-Scope Completion Task 4; Plan Hardening Task 3 | Covered; supplier profiles, PO lifecycle, partial receiving, returns, costing, balances, attachments/payment status, replenishment settings |
| 13. Orders and operational history | Orders/Customers/Delivery; Plan Hardening Task 4 | Covered; unified POS/ONLINE reads, immutable finalized history, controlled cancel/refund/return, reason-coded adjustments |
| 14. Customers, CRM, loyalty, promotions, segments | Orders/Customers/Delivery; Approved-Scope Completion Task 5; Spec-Coverage Hardening Task 3 | Covered; canonical Egyptian-phone identity, merge, addresses/notes/tags/history, loyalty rule completeness, promotion types/limits/scope/stacking, segments |
| 15. Staff, shifts, attendance, staff payments | Workforce; Plan Hardening Task 2 | Covered; global employee identity, shop assignments, PIN coherence with linked Operations workers, shifts, attendance, leave, wage estimates, payment records |
| 16. Delivery management | Orders/Customers/Delivery Task 5 | Covered; zones/routing/hours/riders/status history, no live GPS |
| 17. Finance, Bank/Cash, expenses, reconciliation, profit | Finance/Reports; Approved-Scope Completion Task 4; Spec-Coverage Hardening Task 4 | Covered; operating profit, expenses/recurrence, private optional receipts, bank/cash movements, settlements, reconciliations, X/Z history |
| 18. Payments, checkout, order types, receipts, reason codes | Catalog/Settings Task 5; Spec-Coverage Hardening Task 5; Plan Hardening Task 4 | Covered; per-shop methods/channel rules, checkout/tax/service/delivery/stacking rules, receipt/order-number settings, central reason families |
| 19. Shops, devices, printers, health, operations management | Catalog/Settings; WhatsApp/Operations Task 5; Approved-Scope Completion special hours; Spec-Coverage Hardening Task 5 | Covered; shop lifecycle/copy/assign/overrides, devices, printers, shop health, special hours, opening/closing and manager log |
| 20. WhatsApp control center | WhatsApp/Operations; Approved-Scope Completion push; Reliability | Covered; oversight/config, templates/quick replies/rules/analytics/health, system-origin event messages, safe not-configured state, Operations retains live reply authority |
| 21. Audit, approvals, immutable history | Approvals/Audit; Reliability command idempotency; shared archive policy | Covered; immutable audit, one-time approval execution, compensating events instead of history rewrite |
| 22. Scheduling and time semantics | Catalog/Settings scheduler; Finance recurrence; Approved-Scope Completion; Master | Covered; `Africa/Cairo` business semantics and absolute database timestamps |
| 23. PWA, connectivity, offline behavior | Foundation PWA base; Reliability Tasks 2–3; Approved-Scope Completion push | Covered; installable shell, stale/offline indication, network-only mutations, no offline mutation queue |
| 24. Data contracts, commands, server boundaries | Foundation shared contracts; Reliability command executor; domain BFF services | Covered; explicit typed contracts and server-side authorization/atomic commands |
| 25. Data-model evolution and compatibility | Foundation; Catalog; Customers; Workforce; Inventory | Covered; additive business-level layer and compatibility mappings, no destructive replacement of current production contracts |
| 26. Concurrency, idempotency, error handling | Reliability Tasks 1–2; Catalog concurrency; Approvals | Covered; version fences, durable idempotency, transactional business commands, plain-English errors |
| 27. Security requirements | Foundation/Auth; Approvals; Reliability; both hardening plans | Covered; deny-by-default, no privileged browser secrets, PIN hash/rate-limit/session controls, shop isolation, audit and re-PIN |
| 28. Testing strategy | Every task uses RED→GREEN; Reliability CI/cross-app; Spec-Coverage Hardening Task 8 | Covered; domain/integration/UI, phone-first, cross-app, security, migration and explicit accessibility testing |
| 29. Deployment and operational safety | Reliability Task 6; Plan Hardening Task 5 | Covered; exact separate `tux-admin` Vercel monorepo contract, root-workspace install/build, `/api/*` preservation, production smoke acceptance |
| 30. Archive and delete policy | Approved-Scope Completion catalog archive; Workforce/domain lifecycle; Spec-Coverage Hardening Task 7 | Covered explicitly across used business entities and immutable history |
| 31. Explicit excluded scope | Master global constraints + relevant domain-plan constraints | Covered; import/export, full accounting/tax/payroll engine, bank feed, live GPS, offline mutation queue, destructive history reset remain excluded |

**Coverage result:** No approved design section remains without an implementation task or a mandatory cross-plan hardening insertion point.

## 2. Repairs Made During Self-Review

The review found concrete plan ambiguities and corrected them before implementation:

1. The Orders plan declared `cancelActiveOrder` but one test called `cancelOrder`; the test now uses `cancelActiveOrder` consistently.
2. The Catalog plan declared `publishCatalogDraft` but one test called a generic `publish`; the test/RPC expectation now use `publishCatalogDraft` consistently.
3. The Inventory plan's simple reorder example is explicitly superseded by the final supplier-aware `suggestOrderQuantity({ available, par, incoming, minimumOrder, orderMultiple })` contract. `available` already means on-hand minus reserved, preventing double subtraction.
4. The Reports contract now explicitly includes `AdjustmentReport` and `reportService.adjustments(filters, principal)` for manual discount/comp/promotion/cancellation reporting.
5. Admin/Operations PIN coherence now checks candidate PINs against other active worker verifier hashes in target shops before atomic propagation, preventing ambiguous worker login even though legacy PBKDF2 hashes are salted.
6. The one-time first-OWNER bootstrap is explicit and service-role-only; no default production PIN is stored in source.
7. Admin login throttling, stable permission keys, and generic recent acting-user re-PIN are now explicit rather than implicit security requirements.
8. OWNER-only emergency negative inventory is explicitly separated from normal order reservation and manual adjustment behavior.
9. Loyalty minimum redemption, configurable earning/redemption, optional expiry, and promotion kind/usage/channel/stacking rules are explicit.
10. Optional expense receipt attachment security is explicit and uses private/trusted storage access.
11. Shop lifecycle/copy settings, detailed payment/checkout/receipt behavior, deduplicated domain alerts, cross-domain archive/delete behavior, and accessibility acceptance are now explicit tasks.
12. Reliability cross-app testing no longer contains a placeholder `throw`; it defines `PublishedSurfaceSnapshot`, a real consistency assertion, and a real RED→GREEN unit contract plus cross-app E2E adaptation.
13. Reliability deployment Task 6 now directly states the same exact Vercel contract as the hardening addendum, eliminating competing deployment instructions.

## 3. Canonical Cross-Plan Type and Method Names

Executors must use these names consistently unless a later reviewed plan amendment changes all call sites/contracts together:

```ts
AdminRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF'
AdminPermission = (typeof ADMIN_PERMISSIONS)[number]
ShopScope = { kind: 'shop'; shopId: string } | { kind: 'all-shops' }
AdminSessionPrincipal.permissions: AdminPermission[]

cancelActiveOrder(...)
publishCatalogDraft(...)
setImmediateAvailability(...)
setEmployeePin(...)
assertPinAvailableForLinkedWorkers(...)
suggestOrderQuantity({ available, par, incoming, minimumOrder, orderMultiple })
reportService.adjustments(filters, principal)
assertCrossAppPublishConsistency(admin, menu, operations)
```

The existing production order status vocabulary remains `ACTIVE | DONE | CANCELLED | RETURNED`; `Void / Cancelled` is reporting copy, not a new persisted state. Existing Operations device membership/authentication remains separate from the Admin human-role/session model.

## 4. Placeholder Scan

The complete plan set was checked for the writing-plans red flags `TBD`, `TODO`, `implement later`, `fill in details`, `appropriate error handling`, `handle edge cases`, `Similar to`, and unresolved `not implemented` placeholders. The only concrete placeholder found during review was the original cross-app test's unconditional `throw`; it was replaced with the typed executable consistency contract described above. No known placeholder remains in the reviewed plan set.

## 5. Pre-Implementation Gate

Planning is accepted for execution only when all of the following remain true at the branch head:

- the approved design spec is unchanged or any later design change has an explicit plan amendment;
- the master plan references both mandatory hardening documents;
- numbered domain plans and hardening insertion points are executed together, not treated as optional work;
- implementation begins in an isolated execution branch/worktree, not on the planning branch;
- implementation follows task-level RED → GREEN verification and focused commits;
- no task is marked complete without fresh command/test evidence;
- production acceptance is not claimed from a Vercel `READY` state alone; the full mobile/cross-app/security/migration acceptance gate must pass.

**Self-review conclusion:** the implementation plan set is ready for an execution choice. This conclusion applies to planning completeness only; application implementation has not started.

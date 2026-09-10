# TUX Admin Implementation Plan Self-Review

**Reviewed spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

**Reviewed plan set:** master plan, ten numbered domain/reliability plans, `2026-09-10-tux-admin-plan-hardening.md`, `2026-09-10-tux-admin-spec-coverage-hardening.md`, `2026-09-10-tux-admin-review-hardening.md`, and `2026-09-10-tux-admin-review-hardening-2.md`.

**Purpose:** Record the required writing-plans self-review before any application implementation begins. This document is evidence about plan coverage and consistency only; it does not claim that the planned software/tests are implemented or passing.

## 1. Specification Coverage Matrix

| Spec section | Implementation-plan coverage | Review result |
| --- | --- | --- |
| 1. Purpose and product goal | Master plan + all domain plans | Covered |
| 2. Existing production architecture | Master; Foundation/Auth; Reliability | Covered; one canonical Supabase preserved |
| 3. Product authority boundaries | Master; Orders; Finance; WhatsApp/Operations; Review Hardening | Covered; Admin is management plane, Operations remains live business-day and active-order execution authority, Menu remains customer-facing |
| 4. Approved technical architecture | Foundation/Auth; Master; Reliability | Covered; `apps/admin` + same-origin trusted BFF + canonical backend |
| 5. Business and multi-shop model | Foundation/Auth; Catalog/Settings; Customers; Workforce | Covered; business-level identities with shop-specific operational state/overrides |
| 6. Design system and adaptive UX | Foundation/Auth/Shell; Approved-Scope Completion; Spec-Coverage Hardening accessibility task | Covered; Apple-HIG-guided, mobile-first, adaptive, light/dark/system |
| 7. Navigation and application shell | Foundation/Auth/Shell | Covered; phone bottom navigation, tablet/desktop adaptive shell, permission-aware destinations |
| 8. Admin authentication, roles, permissions, re-auth, approvals | Foundation/Auth; Approvals/Audit; Plan Hardening; Spec-Coverage Hardening Task 1; Review Hardening Amendment 1; Review Hardening 2 Amendment 6 | Covered: PIN-only, first OWNER bootstrap, stable permissions, throttling, sessions, acting-user re-PIN, distinct-person approval, and a production runner for durable approval jobs |
| 9. Dashboard, reports, alerts, targets, owner summary | Finance/Reports; Approved-Scope Completion Tasks 1–2/6; Reliability; Spec-Coverage Hardening Task 6 | Covered; role-adaptive dashboard, saved/report views/targets, deduplicated alerts, owner summary, push |
| 10. Catalog, pricing, availability, publishing | Catalog/Settings; Approved-Scope Completion Task 3; Reliability Task 5 | Covered; master compatibility layer, shop overrides, draft/preview/atomic publish, immediate availability, images, bulk actions, versioning, scheduling, concurrency |
| 11. Inventory and recipes | Inventory/Purchasing; Plan Hardening Task 3; Spec-Coverage Hardening Task 2; Review Hardening 2 Amendment 7 | Covered; existing ledger extended in place, reservation/costing/stocktake/transfers/par/reorder plus authoritative remote movement feed into Operations local stock and stale-inventory fencing |
| 12. Purchasing and suppliers | Inventory/Purchasing; Approved-Scope Completion Task 4; Plan Hardening Task 3; Review Hardening 2 Amendment 9 | Covered; supplier/PO/receiving/returns plus immutable supplier-payment allocations, finance posting, payment status, and supplier-balance derivation |
| 13. Orders and operational history | Orders/Customers/Delivery; Plan Hardening Task 4; Review Hardening Amendment 3 | Covered; controlled Admin cancel/refund/return, immutable finalized history, and CAS/reconciliation so stale local Operations transitions cannot overwrite canonical lifecycle state |
| 14. Customers, CRM, loyalty, promotions, segments | Orders/Customers/Delivery; Approved-Scope Completion Task 5; Spec-Coverage Hardening Task 3; Review Hardening Amendment 5 | Covered; canonical Egyptian-phone identity, merge, CRM detail, complete loyalty/promotion rules, and atomic enforcement/snapshots in both POS and ONLINE order placement |
| 15. Staff, shifts, attendance, staff payments | Workforce; Plan Hardening Task 2; Review Hardening 2 Amendment 8 | Covered; identity/assignments/PIN coherence/shifts/attendance/leave/wage estimates plus staff payment + money movement + salary expense/reporting fact exactly once |
| 16. Delivery management | Orders/Customers/Delivery Task 5 | Covered; zones/routing/hours/riders/status history, no live GPS |
| 17. Finance, Bank/Cash, expenses, reconciliation, profit | Finance/Reports; Approved-Scope Completion Task 4; Spec-Coverage Hardening Task 4; Review Hardening Amendment 2; Review Hardening 2 Amendments 8–9 | Covered; shared finance core, Operations-owned day closure, Admin-derived X/Z history, salary expense reconciliation, supplier payments, bank/cash/expense/profit reporting |
| 18. Payments, checkout, order types, receipts, reason codes | Catalog/Settings Task 5; Spec-Coverage Hardening Task 5; Plan Hardening Task 4; Review Hardening Amendment 4 | Covered; settings propagate into Menu, POS, and ONLINE trusted order execution with authoritative total/rule validation and immutable future-order snapshots |
| 19. Shops, devices, printers, health, operations management | Catalog/Settings; WhatsApp/Operations Task 5; Approved-Scope Completion special hours; Spec-Coverage Hardening Task 5 | Covered; shop lifecycle/copy/assign/overrides, devices, printers, shop health, special hours, opening/closing visibility and manager log |
| 20. WhatsApp control center | WhatsApp/Operations; Approved-Scope Completion push; Reliability | Covered; oversight/config, templates/quick replies/rules/analytics/health, system-origin event messages, safe not-configured state, Operations retains live reply authority |
| 21. Audit, approvals, immutable history | Approvals/Audit; Reliability command idempotency; shared archive policy; both Review Hardening addenda | Covered; immutable audit, distinct second-person approval, one-time recoverable execution with guaranteed runner, compensating events instead of history rewrite |
| 22. Scheduling and time semantics | Catalog/Settings scheduler; Finance recurrence; Approved-Scope Completion; Master | Covered; `Africa/Cairo` business semantics and absolute database timestamps |
| 23. PWA, connectivity, offline behavior | Foundation PWA base; Reliability Tasks 2–3; Approved-Scope Completion push; Review Hardening Amendments 3/7 | Covered; Admin network-only mutations; Operations local-first behavior gains lifecycle and inventory reconciliation fences on reconnect |
| 24. Data contracts, commands, server boundaries | Foundation shared contracts; Reliability command executor; domain BFF services; both Review Hardening addenda | Covered; explicit typed contracts, server authorization/atomic commands, lifecycle CAS/conflict receipts, authoritative checkout/loyalty evaluation, durable approval runner, inventory pull feed |
| 25. Data-model evolution and compatibility | Foundation; Catalog; Customers; Workforce; Inventory; both Review Hardening addenda | Covered; additive compatibility layers, future-order snapshots, inventory feed/cursors, immutable payment/reporting events; no destructive replacement of production contracts |
| 26. Concurrency, idempotency, error handling | Reliability Tasks 1–2; Catalog concurrency; Approvals; both Review Hardening addenda | Covered; version fences, durable idempotency, lifecycle CAS/reconciliation, promotion/loyalty concurrency, approval leases+runner, inventory cursor/conflict fencing, payment command idempotency |
| 27. Security requirements | Foundation/Auth; Approvals; Reliability; all hardening plans | Covered; deny-by-default, no privileged browser secrets, PIN/session/rate-limit controls, shop isolation, distinct approver, runner authentication, audit and re-PIN |
| 28. Testing strategy | Every task uses RED→GREEN; Reliability CI/cross-app; Spec-Coverage Hardening Task 8; both Review Hardening addenda | Covered; domain/integration/UI, phone-first, cross-app, race/concurrency, runner/recovery, inventory convergence, financial reconciliation, security, migration and accessibility testing |
| 29. Deployment and operational safety | Reliability Task 6; Plan Hardening Task 5; Review Hardening 2 Amendment 6 | Covered; exact separate `tux-admin` Vercel contract plus verified scheduled durable-approval runner and production smoke acceptance |
| 30. Archive and delete policy | Approved-Scope Completion catalog archive; Workforce/domain lifecycle; Spec-Coverage Hardening Task 7 | Covered explicitly across used business entities and immutable history |
| 31. Explicit excluded scope | Master global constraints + relevant domain-plan constraints | Covered; import/export, full accounting/tax/payroll engine, bank feed, live GPS, offline Admin mutation queue, destructive history reset remain excluded |

**Coverage result:** No approved design section remains without an implementation task or mandatory hardening insertion point. Both reviewed hardening addenda are required where original domain-plan detail was unsafe, incomplete, or lacked a production execution path.

## 2. Repairs Made During Self-Review and Codex Review

The review process found concrete plan ambiguities and corrected them before application implementation:

1. The Orders plan declared `cancelActiveOrder` but one test called `cancelOrder`; the test now uses `cancelActiveOrder` consistently.
2. The Catalog plan declared `publishCatalogDraft` but one test called a generic `publish`; the test/RPC expectation now use `publishCatalogDraft` consistently.
3. The Inventory plan's simple reorder example is superseded by the supplier-aware `suggestOrderQuantity({ available, par, incoming, minimumOrder, orderMultiple })` contract.
4. Reports explicitly include `AdjustmentReport` and `reportService.adjustments(filters, principal)` for manual adjustment reporting.
5. Admin/Operations PIN coherence checks candidate PINs against active worker verifier hashes before propagation.
6. The one-time first-OWNER bootstrap is service-role-only; no production PIN is stored in source.
7. Admin login throttling, stable permission keys, and recent acting-user re-PIN are explicit.
8. OWNER-only emergency negative inventory is separated from normal reservation/adjustment behavior.
9. Loyalty and promotion rule completeness is explicit.
10. Optional expense receipt attachment security uses private/trusted storage access.
11. Shop/payment/checkout/receipt lifecycle, alerts, archive/delete, and accessibility requirements are explicit.
12. Reliability cross-app testing contains executable consistency contracts rather than placeholders.
13. Reliability deployment and Vercel hardening instructions are aligned.
14. Existing `public.inventory_movements` is extended additively with Operations compatibility preserved.
15. Every new Admin table/RPC is browser-deny-by-default through RLS/privilege revocation and trusted server execution.
16. Approval execution is durably recoverable through idempotent command boundaries and durable lease/job state.
17. Minimal finance account/movement primitives are established before Workforce staff payments and extended by Plan 7.
18. Second-person approval rejects requester self-approval, including OWNER.
19. Operations remains the only canonical business-day closer; Admin finalizes finance history only from CLOSED days.
20. Admin cancellation and Operations lifecycle transitions share canonical CAS/reconciliation semantics.
21. Checkout/payment configuration has explicit Menu, POS, ONLINE, configuration-sync, snapshot, and materializer insertion points.
22. Loyalty/promotions have explicit POS/ONLINE placement integration, usage/balance concurrency, applied-rule snapshots, and compensating ledger behavior.
23. Durable approval jobs now require an independently scheduled production runner; persisted READY/RETRYABLE state alone is not considered recovery.
24. Admin-origin inventory adjustment/stocktake/waste/transfer/receiving/return movements now require a monotonic shop feed into Operations local SQLite plus stale-inventory conflict fencing.
25. `record_staff_payment_v1` must produce or explicitly derive exactly one salary expense/reporting fact in the same idempotent transaction as the staff payment and money movement, so profit cannot omit wages or double count them.
26. Supplier `UNPAID | PARTIALLY_PAID | PAID` and balance/status now require immutable supplier-payment events/allocations tied atomically to a finance account movement and reconciled with purchase returns.

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
finalizeDay(...)
```

The production order status vocabulary remains `ACTIVE | DONE | CANCELLED | RETURNED`; `Void / Cancelled` is reporting copy, not a new persisted state. Operations device authentication remains separate from Admin human sessions. Canonical business-day closing remains Operations-owned. Exact internal names for lifecycle CAS receipts, inventory-feed cursors, salary-expense facts, and supplier-payment allocations may be refined during implementation only if the reviewed semantics and all call sites/tests remain consistent.

## 4. Placeholder and Contradiction Scan

The complete plan set was checked for `TBD`, `TODO`, `implement later`, `fill in details`, `appropriate error handling`, `handle edge cases`, `Similar to`, and unresolved `not implemented` placeholders. The original cross-app placeholder was replaced by an executable consistency contract.

Codex review then found semantic gaps a text-placeholder scan could not detect. `2026-09-10-tux-admin-review-hardening.md` supersedes: self-approval, Admin-owned business-day closing, Admin-cancellation/local-outbox races, checkout settings not reaching order consumers, and loyalty/promotions not reaching order placement. `2026-09-10-tux-admin-review-hardening-2.md` adds the missing durable approval runner, Admin→Operations inventory convergence, staff-payment salary expense fact, and supplier-payment persistence. Executors must apply both addenda at their insertion points.

## 5. Pre-Implementation Gate

Planning is accepted for execution only when all of the following remain true at the branch head:

- the approved design spec is unchanged or any design change has an explicit reviewed amendment;
- the master plan references every mandatory hardening document;
- numbered domain plans and hardening insertion points are executed together, never treated as optional work;
- where either Review Hardening addendum supersedes or completes an older implementation detail, the reviewed addendum is authoritative;
- implementation begins in an isolated execution branch/worktree, not on the planning branch;
- implementation follows task-level RED → GREEN verification and focused commits;
- no task is marked complete without fresh command/test evidence;
- production acceptance is not claimed from Vercel `READY` alone; full mobile/cross-app/security/migration/recovery acceptance must pass.

**Self-review conclusion:** after applying all mandatory hardening amendments above, the implementation plan set is ready for exact-head execution review. This conclusion applies to planning completeness only; application implementation has not started.

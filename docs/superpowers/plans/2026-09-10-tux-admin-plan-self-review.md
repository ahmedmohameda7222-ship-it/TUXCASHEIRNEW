# TUX Admin Implementation Plan Self-Review

**Reviewed spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

**Reviewed plan set:** master plan, ten numbered domain/reliability plans, `2026-09-10-tux-admin-plan-hardening.md`, `2026-09-10-tux-admin-spec-coverage-hardening.md`, `2026-09-10-tux-admin-review-hardening.md`, `2026-09-10-tux-admin-review-hardening-2.md`, and `2026-09-10-tux-admin-review-hardening-3.md`.

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
| 9. Dashboard, reports, alerts, targets, owner summary | Finance/Reports; Approved-Scope Completion Tasks 1–2/6; Reliability; Spec-Coverage Hardening Task 6; Review Hardening 3 Amendment 10 | Covered; role-adaptive dashboard, saved/report views/targets, deduplicated alerts, owner summary, push, and guaranteed production scheduling |
| 10. Catalog, pricing, availability, publishing | Catalog/Settings; Approved-Scope Completion Task 3; Reliability Task 5; Review Hardening 3 Amendment 10 | Covered; master compatibility layer, shop overrides, draft/preview/atomic publish, images/bulk/versioning/scheduling, with production cron invocation for due activations |
| 11. Inventory and recipes | Inventory/Purchasing; Plan Hardening Task 3; Spec-Coverage Hardening Task 2; Review Hardening 2 Amendment 7; Review Hardening 3 Amendment 13 | Covered; existing ledger extended in place, reservation/costing/stocktake/transfers/par/reorder, authoritative remote movement feed into Operations, stale-inventory fencing, and structured inventory reason codes |
| 12. Purchasing and suppliers | Inventory/Purchasing; Approved-Scope Completion Task 4; Plan Hardening Task 3; Review Hardening 2 Amendment 9; Review Hardening 3 Amendment 11 | Covered; supplier/PO/receiving/returns plus immutable supplier-payment allocations, finance posting, payment status/balance derivation, and PO-level concurrency serialization |
| 13. Orders and operational history | Orders/Customers/Delivery; Plan Hardening Task 4; Review Hardening Amendment 3; Review Hardening 3 Amendment 13 | Covered; controlled cancel/refund/return, immutable finalized history, lifecycle CAS/reconciliation, and central reason-code snapshots rather than free-text classification |
| 14. Customers, CRM, loyalty, promotions, segments | Orders/Customers/Delivery; Approved-Scope Completion Task 5; Spec-Coverage Hardening Task 3; Review Hardening Amendment 5 | Covered; canonical Egyptian-phone identity, merge, CRM detail, complete loyalty/promotion rules, and atomic enforcement/snapshots in POS and ONLINE placement |
| 15. Staff, shifts, attendance, staff payments | Workforce; Plan Hardening Task 2; Review Hardening 2 Amendment 8 | Covered; identity/assignments/PIN coherence/shifts/attendance/leave/wage estimates plus staff payment + money movement + salary expense/reporting fact exactly once |
| 16. Delivery management | Orders/Customers/Delivery Task 5 | Covered; zones/routing/hours/riders/status history, no live GPS |
| 17. Finance, Bank/Cash, expenses, reconciliation, profit | Finance/Reports; Approved-Scope Completion Task 4; Spec-Coverage Hardening Task 4; Review Hardening Amendment 2; Review Hardening 2 Amendments 8–9; Review Hardening 3 Amendments 10–13 where applicable | Covered; shared finance core, Operations-owned day closure, Admin-derived X/Z history, salary expense reconciliation, supplier payments, recurring-expense scheduling, structured cash reasons, and reconciled profit/money reporting |
| 18. Payments, checkout, order types, receipts, reason codes | Catalog/Settings Task 5; Spec-Coverage Hardening Task 5; Plan Hardening Task 4; Review Hardening Amendment 4; Review Hardening 3 Amendments 12–13 | Covered; checkout settings propagate into trusted order execution; receipt identity/order numbering propagate into Operations numbering/printing; central reason codes propagate into Operations and immutable event snapshots |
| 19. Shops, devices, printers, health, operations management | Catalog/Settings; WhatsApp/Operations Task 5; Approved-Scope Completion special hours; Spec-Coverage Hardening Task 5; Review Hardening 3 Amendment 12 | Covered; shop lifecycle/contact authority/devices/printers/health/special hours/opening-closing visibility, with shop receipt identity consumed by Operations printing |
| 20. WhatsApp control center | WhatsApp/Operations; Approved-Scope Completion push; Reliability | Covered; oversight/config/templates/quick replies/rules/analytics/health, system-origin event messages, safe not-configured state, Operations retains live reply authority |
| 21. Audit, approvals, immutable history | Approvals/Audit; Reliability command idempotency; shared archive policy; Review Hardening addenda | Covered; immutable audit, distinct second-person approval, one-time recoverable execution with guaranteed runner, compensating events instead of history rewrite |
| 22. Scheduling and time semantics | Catalog/Settings scheduler; Finance recurrence; Approved-Scope Completion; Master; Review Hardening 3 Amendment 10 | Covered; `Africa/Cairo` business semantics plus explicit production cron triggers whose jobs evaluate due business state server-side |
| 23. PWA, connectivity, offline behavior | Foundation PWA base; Reliability Tasks 2–3; Approved-Scope Completion push; Review Hardening Amendments 3/7/13 | Covered; Admin network-only mutations; Operations local-first behavior gains lifecycle/inventory reconciliation plus versioned offline reason snapshots |
| 24. Data contracts, commands, server boundaries | Foundation contracts; Reliability command executor; domain BFF services; Review Hardening addenda | Covered; typed contracts, server authorization/atomic commands, lifecycle CAS, authoritative checkout/loyalty, durable job runners, inventory pull, receipt/reason snapshots |
| 25. Data-model evolution and compatibility | Foundation; Catalog; Customers; Workforce; Inventory; Review Hardening addenda | Covered; additive compatibility layers, future-order/receipt/reason snapshots, inventory feed/cursors, immutable payment/reporting events; no destructive replacement of production contracts |
| 26. Concurrency, idempotency, error handling | Reliability Tasks 1–2; Catalog concurrency; Approvals; Review Hardening addenda | Covered; version fences, durable idempotency, lifecycle CAS/reconciliation, promotion/loyalty concurrency, approval leases+runner, inventory cursor fencing, supplier payable serialization |
| 27. Security requirements | Foundation/Auth; Approvals; Reliability; all hardening plans | Covered; deny-by-default, no privileged browser secrets, PIN/session/rate-limit controls, shop isolation, distinct approver, cron authentication, audit and re-PIN |
| 28. Testing strategy | Every task uses RED→GREEN; Reliability CI/cross-app; Spec-Coverage Hardening Task 8; Review Hardening addenda | Covered; domain/integration/UI, phone-first, cross-app, race/concurrency, runner/recovery, inventory convergence, supplier-payable races, receipt/reason propagation, financial reconciliation, security, migration and accessibility testing |
| 29. Deployment and operational safety | Reliability Task 6; Plan Hardening Task 5; Review Hardening 2 Amendment 6; Review Hardening 3 Amendment 10 | Covered; exact separate `tux-admin` Vercel contract plus explicit authenticated cron entries and cadence checks for every planned Admin scheduled route |
| 30. Archive and delete policy | Approved-Scope Completion catalog archive; Workforce/domain lifecycle; Spec-Coverage Hardening Task 7 | Covered explicitly across used business entities and immutable history |
| 31. Explicit excluded scope | Master global constraints + relevant domain-plan constraints | Covered; import/export, full accounting/tax/payroll engine, bank feed, live GPS, offline Admin mutation queue, destructive history reset remain excluded |

**Coverage result:** No approved design section remains without an implementation task or mandatory hardening insertion point. All three reviewed hardening addenda are required where original domain-plan detail was unsafe, incomplete, or lacked a production/canonical-consumer execution path.

## 2. Repairs Made During Self-Review and Codex Review

The review process found concrete plan ambiguities and corrected them before application implementation:

1. Orders `cancelActiveOrder` naming is consistent.
2. Catalog `publishCatalogDraft` naming is consistent.
3. Inventory reorder suggestions use the supplier-aware contract without double-subtracting reservations.
4. Reports explicitly include manual adjustment reporting.
5. Admin/Operations PIN coherence checks active worker verifier hashes before propagation.
6. First-OWNER bootstrap is service-role-only with no source-stored production PIN.
7. Login throttling, stable permission keys, and recent acting-user re-PIN are explicit.
8. OWNER emergency negative inventory is separated from normal stock behavior.
9. Loyalty/promotion rule completeness is explicit.
10. Expense receipt attachments use private/trusted storage.
11. Shop/payment/checkout/receipt lifecycle, alerts, archive/delete, and accessibility requirements are explicit.
12. Reliability cross-app tests are executable rather than placeholders.
13. Reliability/Vercel deployment instructions are aligned.
14. Existing `public.inventory_movements` is extended additively with Operations compatibility preserved.
15. Every new Admin table/RPC is browser-deny-by-default through RLS/privilege revocation and trusted server execution.
16. Approval execution is recoverable through idempotent command boundaries and durable lease/job state.
17. Minimal finance account/movement primitives are established before Workforce staff payments and extended by Plan 7.
18. Second-person approval rejects requester self-approval, including OWNER.
19. Operations remains the only canonical business-day closer; Admin finance finalizes only from CLOSED days.
20. Admin cancellation and Operations lifecycle transitions share canonical CAS/reconciliation semantics.
21. Checkout/payment configuration has explicit Menu, POS, ONLINE, configuration-sync, snapshot, and materializer insertion points.
22. Loyalty/promotions have explicit POS/ONLINE placement integration, usage/balance concurrency, applied-rule snapshots, and compensating ledger behavior.
23. Durable approval jobs require an independently scheduled production runner; READY/RETRYABLE persistence alone is insufficient.
24. Admin-origin inventory movements require a monotonic feed into Operations local SQLite plus stale-inventory fencing.
25. `record_staff_payment_v1` must create or explicitly derive exactly one salary expense/reporting fact in the same idempotent transaction as the payment and money movement.
26. Supplier payment status/balance require immutable supplier-payment events/allocations tied atomically to a finance movement and reconciled with purchase returns.
27. Every scheduled Admin route under `apps/admin/api/cron/` now requires an explicit authenticated Vercel cron entry and tested cadence; config scheduling, approval execution, recurring expenses, and owner summaries cannot depend on incidental traffic.
28. Supplier-payment allocations and purchase returns must acquire one PO-level serialization boundary and deterministic multi-PO lock order, so two distinct command ids cannot over-allocate the same payable.
29. Receipt identity/order-number configuration must propagate through Operations configuration sync into collision-free numeric allocation plus immutable order/receipt snapshots consumed by `packages/printing`; the current hard-coded receipt identity is only a legacy fallback.
30. Central reason-code families must propagate through Operations configuration and replace free-text-only classification at applicable cancellation/refund/discount/comp/waste/stock-adjustment/cash-variance/pay-in/pay-out boundaries while preserving optional notes and immutable event-time labels.

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

The production order status vocabulary remains `ACTIVE | DONE | CANCELLED | RETURNED`; `Void / Cancelled` is reporting copy, not a new persisted state. Operations device authentication remains separate from Admin human sessions. Canonical business-day closing remains Operations-owned. Existing numeric `displayOrderNo` remains a compatibility contract; reviewed receipt-number settings extend it additively rather than replacing its type. Exact internal names for lifecycle receipts, inventory cursors, salary-expense facts, supplier-payment allocations, receipt snapshots, and reason snapshots may be refined only if reviewed semantics and all call sites/tests remain consistent.

## 4. Placeholder and Contradiction Scan

The complete plan set was checked for `TBD`, `TODO`, `implement later`, `fill in details`, `appropriate error handling`, `handle edge cases`, `Similar to`, and unresolved `not implemented` placeholders. The original cross-app placeholder was replaced by an executable consistency contract.

Codex semantic review found gaps a text scan could not detect. `2026-09-10-tux-admin-review-hardening.md` supersedes self-approval, Admin-owned business-day closing, Admin-cancellation/local-outbox races, checkout settings not reaching order consumers, and loyalty/promotions not reaching order placement. `2026-09-10-tux-admin-review-hardening-2.md` adds the durable approval runner, Admin→Operations inventory convergence, staff-payment salary expense fact, and supplier-payment persistence. `2026-09-10-tux-admin-review-hardening-3.md` adds complete cron triggering, PO payable serialization, receipt/order-number propagation, and Operations-wide central reason-code enforcement. Executors must apply all three addenda at their insertion points.

## 5. Pre-Implementation Gate

Planning is accepted for execution only when all of the following remain true at the branch head:

- the approved design spec is unchanged or any design change has an explicit reviewed amendment;
- the master plan references every mandatory hardening document;
- numbered domain plans and hardening insertion points are executed together, never treated as optional work;
- where any Review Hardening addendum supersedes or completes an older implementation detail, the latest applicable reviewed addendum is authoritative;
- every planned cron route has an explicit authenticated production trigger/cadence before its feature is accepted;
- implementation begins in an isolated execution branch/worktree, not on the planning branch;
- implementation follows task-level RED → GREEN verification and focused commits;
- no task is marked complete without fresh command/test evidence;
- production acceptance is not claimed from Vercel `READY` alone; full mobile/cross-app/security/migration/recovery/scheduling acceptance must pass.

**Self-review conclusion:** after applying all mandatory hardening amendments above, the implementation plan set is ready for a new exact-head execution review. This conclusion applies to planning completeness only; application implementation has not started.

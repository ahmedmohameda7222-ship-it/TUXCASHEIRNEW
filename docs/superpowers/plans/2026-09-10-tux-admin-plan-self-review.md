# TUX Admin Implementation Plan Self-Review

**Reviewed spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

**Reviewed plan set:** master plan, ten numbered domain/reliability plans, `2026-09-10-tux-admin-plan-hardening.md`, `2026-09-10-tux-admin-spec-coverage-hardening.md`, and `2026-09-10-tux-admin-review-hardening.md`.

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
| 8. Admin authentication, roles, permissions, re-auth, approvals | Foundation/Auth; Approvals/Audit; Plan Hardening; Spec-Coverage Hardening Task 1; Review Hardening Amendment 1 | Covered after hardening: PIN-only, first OWNER bootstrap, stable permissions, throttling, sessions, acting-user re-PIN, and true distinct-person approval |
| 9. Dashboard, reports, alerts, targets, owner summary | Finance/Reports; Approved-Scope Completion Tasks 1–2/6; Reliability; Spec-Coverage Hardening Task 6 | Covered; role-adaptive dashboard, saved/report views/targets, deduplicated alerts, owner summary, push |
| 10. Catalog, pricing, availability, publishing | Catalog/Settings; Approved-Scope Completion Task 3; Reliability Task 5 | Covered; master compatibility layer, shop overrides, draft/preview/atomic publish, immediate availability, images, bulk actions, versioning, scheduling, concurrency |
| 11. Inventory and recipes | Inventory/Purchasing; Plan Hardening Task 3; Spec-Coverage Hardening Task 2 | Covered; existing inventory extended, units, ledger, reservation lifecycle, costing, stocktake, transfers, par/reorder, theoretical-vs-actual, explicit OWNER emergency override |
| 12. Purchasing and suppliers | Inventory/Purchasing; Approved-Scope Completion Task 4; Plan Hardening Task 3 | Covered; supplier profiles, PO lifecycle, partial receiving, returns, costing, balances, attachments/payment status, replenishment settings |
| 13. Orders and operational history | Orders/Customers/Delivery; Plan Hardening Task 4; Review Hardening Amendment 3 | Covered; controlled Admin cancel/refund/return, immutable finalized history, and CAS/reconciliation so stale local Operations transitions cannot overwrite canonical lifecycle state |
| 14. Customers, CRM, loyalty, promotions, segments | Orders/Customers/Delivery; Approved-Scope Completion Task 5; Spec-Coverage Hardening Task 3; Review Hardening Amendment 5 | Covered; canonical Egyptian-phone identity, merge, CRM detail, complete loyalty/promotion rules, and atomic enforcement/snapshots in both POS and ONLINE order placement |
| 15. Staff, shifts, attendance, staff payments | Workforce; Plan Hardening Task 2 | Covered; global employee identity, shop assignments, PIN coherence with linked Operations workers, shifts, attendance, leave, wage estimates, payment records |
| 16. Delivery management | Orders/Customers/Delivery Task 5 | Covered; zones/routing/hours/riders/status history, no live GPS |
| 17. Finance, Bank/Cash, expenses, reconciliation, profit | Finance/Reports; Approved-Scope Completion Task 4; Spec-Coverage Hardening Task 4; Review Hardening Amendment 2 | Covered; finance model and X/Z history preserve Operations as the sole canonical business-day close authority; Admin finalizes immutable finance history only after Operations close |
| 18. Payments, checkout, order types, receipts, reason codes | Catalog/Settings Task 5; Spec-Coverage Hardening Task 5; Plan Hardening Task 4; Review Hardening Amendment 4 | Covered; settings are propagated into Menu, POS, and ONLINE trusted order execution with authoritative total/rule validation and immutable future-order snapshots |
| 19. Shops, devices, printers, health, operations management | Catalog/Settings; WhatsApp/Operations Task 5; Approved-Scope Completion special hours; Spec-Coverage Hardening Task 5 | Covered; shop lifecycle/copy/assign/overrides, devices, printers, shop health, special hours, opening/closing and manager log |
| 20. WhatsApp control center | WhatsApp/Operations; Approved-Scope Completion push; Reliability | Covered; oversight/config, templates/quick replies/rules/analytics/health, system-origin event messages, safe not-configured state, Operations retains live reply authority |
| 21. Audit, approvals, immutable history | Approvals/Audit; Reliability command idempotency; shared archive policy; Review Hardening Amendment 1 | Covered; immutable audit, distinct second-person approval, one-time recoverable execution, compensating events instead of history rewrite |
| 22. Scheduling and time semantics | Catalog/Settings scheduler; Finance recurrence; Approved-Scope Completion; Master | Covered; `Africa/Cairo` business semantics and absolute database timestamps |
| 23. PWA, connectivity, offline behavior | Foundation PWA base; Reliability Tasks 2–3; Approved-Scope Completion push | Covered; installable shell, stale/offline indication, network-only Admin mutations, no offline Admin mutation queue |
| 24. Data contracts, commands, server boundaries | Foundation shared contracts; Reliability command executor; domain BFF services; Review Hardening | Covered; explicit typed contracts, server authorization/atomic commands, lifecycle CAS/conflict receipts, authoritative checkout/loyalty evaluation |
| 25. Data-model evolution and compatibility | Foundation; Catalog; Customers; Workforce; Inventory; Review Hardening | Covered; additive compatibility layers and future-order snapshots, no destructive replacement of current production contracts |
| 26. Concurrency, idempotency, error handling | Reliability Tasks 1–2; Catalog concurrency; Approvals; Review Hardening Amendments 3/5 | Covered; version fences, durable idempotency, lifecycle CAS/reconciliation, promotion-limit and loyalty-balance concurrency controls |
| 27. Security requirements | Foundation/Auth; Approvals; Reliability; all hardening plans | Covered; deny-by-default, no privileged browser secrets, PIN/session/rate-limit controls, shop isolation, distinct approver, audit and re-PIN |
| 28. Testing strategy | Every task uses RED→GREEN; Reliability CI/cross-app; Spec-Coverage Hardening Task 8; Review Hardening | Covered; domain/integration/UI, phone-first, cross-app, race/concurrency, security, migration and explicit accessibility testing |
| 29. Deployment and operational safety | Reliability Task 6; Plan Hardening Task 5 | Covered; exact separate `tux-admin` Vercel monorepo contract, root-workspace install/build, `/api/*` preservation, production smoke acceptance |
| 30. Archive and delete policy | Approved-Scope Completion catalog archive; Workforce/domain lifecycle; Spec-Coverage Hardening Task 7 | Covered explicitly across used business entities and immutable history |
| 31. Explicit excluded scope | Master global constraints + relevant domain-plan constraints | Covered; import/export, full accounting/tax/payroll engine, bank feed, live GPS, offline Admin mutation queue, destructive history reset remain excluded |

**Coverage result:** No approved design section remains without an implementation task or a mandatory cross-plan hardening insertion point. Review Hardening is required where the original domain-plan implementation detail was unsafe or incomplete.

## 2. Repairs Made During Self-Review and Codex Review

The review process found concrete plan ambiguities and corrected them before application implementation:

1. The Orders plan declared `cancelActiveOrder` but one test called `cancelOrder`; the test now uses `cancelActiveOrder` consistently.
2. The Catalog plan declared `publishCatalogDraft` but one test called a generic `publish`; the test/RPC expectation now use `publishCatalogDraft` consistently.
3. The Inventory plan's simple reorder example is explicitly superseded by the final supplier-aware `suggestOrderQuantity({ available, par, incoming, minimumOrder, orderMultiple })` contract. `available` already means on-hand minus reserved, preventing double subtraction.
4. The Reports contract explicitly includes `AdjustmentReport` and `reportService.adjustments(filters, principal)` for manual discount/comp/promotion/cancellation reporting.
5. Admin/Operations PIN coherence checks candidate PINs against other active worker verifier hashes in target shops before atomic propagation, preventing ambiguous worker login even though legacy PBKDF2 hashes are salted.
6. The one-time first-OWNER bootstrap is explicit and service-role-only; no default production PIN is stored in source.
7. Admin login throttling, stable permission keys, and generic recent acting-user re-PIN are explicit rather than implicit security requirements.
8. OWNER-only emergency negative inventory is explicitly separated from normal order reservation and manual adjustment behavior.
9. Loyalty minimum redemption, configurable earning/redemption, optional expiry, and promotion kind/usage/channel/stacking rules are explicit.
10. Optional expense receipt attachment security is explicit and uses private/trusted storage access.
11. Shop lifecycle/copy settings, detailed payment/checkout/receipt behavior, deduplicated domain alerts, cross-domain archive/delete behavior, and accessibility acceptance are explicit tasks.
12. Reliability cross-app testing no longer contains a placeholder `throw`; it defines `PublishedSurfaceSnapshot`, a real consistency assertion, and a real RED→GREEN unit contract plus cross-app E2E adaptation.
13. Reliability deployment Task 6 directly states the same exact Vercel contract as the hardening addendum, eliminating competing deployment instructions.
14. The existing `public.inventory_movements` table is now explicitly extended additively in place; rows, legacy movement types, tenant constraints, identifiers, idempotency, and Operations sync compatibility are preserved.
15. Every new Admin table/RPC is browser-deny-by-default with RLS/privilege revocation and trusted service-role/BFF execution; credential/session/control tables are not exposed through the public Supabase client boundary.
16. Approval execution is durably recoverable across serverless timeout/crash with idempotent command boundaries and durable claim/lease state where a single SQL transaction is not possible.
17. The minimal finance account/movement core is established before Workforce staff payments and Plan 7 extends the same core rather than recreating it.
18. Second-person approval now has an explicit distinct-employee invariant; requester self-approval returns `self_approval_forbidden` even for OWNER.
19. Finance no longer instructs Admin to close canonical business days. Operations closes through its existing End Day flow; Admin finance finalization derives exactly one immutable Z/reconciliation snapshot only after the canonical day is CLOSED.
20. Admin cancellation now has an explicit local-first Operations concurrency contract: canonical lifecycle transitions use compare-and-swap operational revisions, stale outbox transitions receive canonical conflict state, and local SQLite reconciles instead of overwriting the canonical winner.
21. Checkout/payment configuration now has explicit Menu, POS, ONLINE, configuration-sync, order-snapshot, and remote-materializer insertion points. Persisting settings in Admin alone is not accepted.
22. Loyalty/promotions now have explicit POS and ONLINE placement integration, atomic usage-limit/point-balance concurrency, immutable applied-rule snapshots, and compensating ledger behavior. ONLINE may not hard-code `discountMinor: 0` once these rules are enabled.

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

The existing production order status vocabulary remains `ACTIVE | DONE | CANCELLED | RETURNED`; `Void / Cancelled` is reporting copy, not a new persisted state. Existing Operations device membership/authentication remains separate from the Admin human-role/session model. Canonical business-day closing remains Operations-owned. A reviewed implementation may choose exact internal CAS/receipt type names, but it must preserve the lifecycle concurrency semantics specified by Review Hardening Amendment 3.

## 4. Placeholder and Contradiction Scan

The complete plan set was checked for the writing-plans red flags `TBD`, `TODO`, `implement later`, `fill in details`, `appropriate error handling`, `handle edge cases`, `Similar to`, and unresolved `not implemented` placeholders. The original cross-app placeholder was replaced by a typed executable consistency contract.

A later Codex review found five substantive contradictions/integration gaps that a text-placeholder scan could not detect. They are now explicitly superseded by `2026-09-10-tux-admin-review-hardening.md`: self-approval, Admin-owned business-day closing, Admin-cancellation/local-outbox races, checkout settings not reaching order consumers, and loyalty/promotions not reaching order placement. Executors must follow the mandatory reviewed amendment rather than the superseded older implementation detail.

## 5. Pre-Implementation Gate

Planning is accepted for execution only when all of the following remain true at the branch head:

- the approved design spec is unchanged or any later design change has an explicit plan amendment;
- the master plan references all mandatory hardening documents;
- numbered domain plans and hardening insertion points are executed together, not treated as optional work;
- where `2026-09-10-tux-admin-review-hardening.md` explicitly supersedes an older implementation detail, the reviewed amendment is authoritative;
- implementation begins in an isolated execution branch/worktree, not on the planning branch;
- implementation follows task-level RED → GREEN verification and focused commits;
- no task is marked complete without fresh command/test evidence;
- production acceptance is not claimed from a Vercel `READY` state alone; the full mobile/cross-app/security/migration acceptance gate must pass.

**Self-review conclusion:** after applying the mandatory hardening amendments above, the implementation plan set is ready for execution review. This conclusion applies to planning completeness only; application implementation has not started.

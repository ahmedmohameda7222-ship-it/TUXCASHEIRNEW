# TUX Admin Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete approved TUX Admin control plane as a mobile-first PWA without breaking Menu, Operations, or the canonical Supabase authority.

**Architecture:** Implement Admin as `apps/admin`, a separate Vercel deployment in the existing monorepo. Use a same-origin Admin BFF under `apps/admin/api/*` for secure PIN sessions and trusted commands; business mutations call canonical Supabase tables/RPCs with server-only credentials. Shared request/response types live in `packages/admin-contracts`, and existing Menu/Operations contracts remain authoritative consumers of published shop configuration.

**Tech Stack:** React 19.2.8, Vite 8.2.0, TypeScript 6.0.3, Wouter 3.3.5, TanStack React Query 5.90.21, Zod 3.25.76, Tailwind CSS 4.1.14, Radix UI primitives, Supabase JS 2.49+, PostgreSQL/Supabase migrations and RPCs, Vitest 4.1.10, Playwright 1.62.1, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- English-only Admin UI.
- Business timezone is `Africa/Cairo`; database timestamps remain absolute `timestamptz` values.
- Default currency is EGP.
- Mobile is the primary design target; tablet and desktop are adaptive presentations of the same capabilities.
- Admin is not another POS; Operations remains live execution authority and Menu remains customer-facing authority.
- One canonical Supabase remains the only business source of truth.
- Browser code never receives Supabase service-role, Meta, payment-provider, or other privileged secrets.
- Every protected read and command is server-authorized by actor, permission, and shop scope; authorization is deny-by-default.
- Used business records are archived, not hard-deleted; historical transactions and audit events are immutable.
- Important mutations are atomic and idempotent and use optimistic concurrency where a stale edit could overwrite another user.
- Offline mutation queues are prohibited; mutation controls disable when offline.
- No import functionality and no export functionality.
- No full accounting, tax filing, payroll-tax engine, live rider GPS, bank-feed integration, or destructive financial/history reset.
- WhatsApp provider setup does not block Admin completion; WhatsApp Admin management surfaces must still be built.
- Each implementation task follows RED → GREEN TDD, focused review, and a small commit.

---

## Execution Decomposition

The approved spec is too broad for one safe execution checklist. Execute these plans in order; each plan leaves a testable system boundary for the next plan:

1. `2026-09-10-tux-admin-foundation-auth-shell.md` — app scaffold, Admin contracts, business identity, PIN auth/session, RBAC/shop scope, adaptive shell, PWA base.
2. `2026-09-10-tux-admin-catalog-settings.md` — master catalog compatibility layer, shop overrides, drafts, atomic publish, scheduled/recurring availability, shops/order types/payments/checkout/receipts/reason codes.
3. `2026-09-10-tux-admin-approvals-audit.md` — immutable audit ledger, approval thresholds, one-time approval execution, PIN-confirmed Approve/Reject UI.
4. `2026-09-10-tux-admin-inventory-purchasing.md` — stock ledger, reservation lifecycle, recipes/costing, stocktake, waste, transfers, par levels, actual-vs-theoretical, suppliers, purchase orders/receiving/returns.
5. `2026-09-10-tux-admin-orders-customers-delivery.md` — order supervision/refunds, canonical customer identity, loyalty, promotions, segments, customer merge, delivery zones/routing/riders.
6. `2026-09-10-tux-admin-workforce.md` — employee identity, shop assignments, shifts, attendance, leave, wage estimates, staff payment records; this plan first establishes the minimal `finance_accounts`/`finance_movements` prerequisite required to validate and atomically record staff payments.
7. `2026-09-10-tux-admin-finance-reports.md` — extends the finance core created as the Workforce prerequisite, then adds expenses, Bank & Cash management, settlements, X/Z end-day history, cashier reconciliation, owner contributions/withdrawals, profit/COGS reporting, advanced report filters/drill-down/saved views/targets/owner summary.
8. `2026-09-10-tux-admin-whatsapp-operations.md` — WhatsApp control center, templates, quick replies, automatic order messages, analytics, health, plus opening/closing checklists, manager log, devices/printers/shop health.
9. `2026-09-10-tux-admin-approved-scope-completion.md` — role-adaptive Dashboard, dashboard customization, product image/bulk/archive completion, purchasing documents/payment state, recurring expenses, CRM detail, special hours, appearance, reusable UX states, and privacy-safe web push.
10. `2026-09-10-tux-admin-reliability-production.md` — concurrency hardening, durable idempotency, offline behavior, observability, cross-app regression gates, real-mobile acceptance, exact Vercel production contract, and production smoke tests.

The Workforce finance prerequisite is a dependency-placement change only, not a new product phase and not a reordering of Plans 6 and 7. It creates only the generic account/movement primitives and the `STAFF_PAYMENT` posting path needed by `record_staff_payment_v1`. All broader Finance behavior remains in Plan 7, which must alter/extend that core additively rather than recreate it.

### Mandatory cross-plan hardening

`2026-09-10-tux-admin-plan-hardening.md` is executed at the insertion points named inside it. It closes one-time first-OWNER bootstrap, canonical employee/linked-worker PIN coherence, supplier-aware replenishment metadata, reason-coded discount/comp/cancellation reporting, and the exact Admin Vercel monorepo contract.

`2026-09-10-tux-admin-spec-coverage-hardening.md` is also mandatory and is executed at its named insertion points. It makes the remaining approved spec requirements explicit: stable permission taxonomy, PIN throttling and generic sensitive re-PIN, OWNER-only emergency negative-stock adjustment, complete loyalty/promotion rules, private expense receipts, complete shop/payment/checkout lifecycle settings, deduplicated domain alerts, shared archive/delete enforcement, and accessibility acceptance.

`2026-09-10-tux-admin-review-hardening.md` is mandatory and supersedes conflicting implementation details in older numbered plans at its named insertion points. It enforces a distinct second-person approver, keeps canonical business-day closing in Operations, makes Admin order cancellation conflict-safe with local-first SQLite/outbox synchronization, wires checkout/payment settings into real Menu and Operations order execution, and wires loyalty/promotions into both POS and ONLINE order placement with atomic usage/balance controls.

`2026-09-10-tux-admin-review-hardening-2.md` is mandatory and closes the next execution gaps found by exact-head review: a production runner must drain durable approval jobs; Admin-origin inventory movements must converge into Operations local stock with a durable cursor/conflict fence; each staff payment must contribute exactly once to salary expense reporting; and supplier payment status/balance must derive from immutable supplier-payment allocations tied atomically to the shared finance-account ledger.

`2026-09-10-tux-admin-review-hardening-3.md` is mandatory and closes the final cross-app/deployment gaps found by the fresh exact-head review: every scheduled Admin route must have an authenticated Vercel cron trigger and tested cadence; supplier-payment allocations and purchase returns must serialize against canonical PO payable state; receipt identity/order-number settings must propagate into Operations numbering and immutable printer snapshots; and central reason codes must propagate into Operations and be enforced/snapshotted at every applicable mutation boundary.

These hardening files do not create separate product phases. Their tasks are folded into the numbered domain plans at the specified insertion points. No implementation checkpoint is accepted if its applicable hardening task remains unresolved. When an older numbered-plan implementation detail conflicts with a mandatory hardening addendum, the later hardening instruction is authoritative so long as the approved product specification is unchanged.

## Cross-Plan Interfaces

All plans depend on these stable interfaces established by Foundation/Auth and finalized by the hardening plans:

```ts
export type AdminRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
export type ShopScope = { kind: 'shop'; shopId: string } | { kind: 'all-shops' };
export type AdminSessionPrincipal = {
  employeeId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  shopIds: string[];
};
export type CommandEnvelope<T> = {
  commandId: string;
  expectedVersion?: number;
  shopId?: string;
  payload: T;
};
export type CommandResult<T> =
  | { ok: true; value: T; version?: number }
  | { ok: false; code: string; message: string; currentVersion?: number };
```

`AdminPermission` is the stable union exported from `packages/admin-contracts/src/auth.ts`; arbitrary permission strings are rejected at the contract boundary. Every Admin BFF mutation resolves the secure-cookie principal and passes an explicit permission and shop requirement into the shared authorization helper before invoking an RPC or service operation.

## Master Verification Gates

- [ ] **Gate 1: Foundation** — Admin build/typecheck/tests, PIN login/session, stable permission taxonomy, login throttling, generic sensitive re-PIN, shop isolation, and one-time OWNER-bootstrap tests pass.
- [ ] **Gate 2: Catalog/config** — Admin publish updates canonical Menu catalog and Operations configuration in one accepted version; checkout/payment/minimum-order/tax/service/stacking plus receipt identity/order-number and central reason-code settings are consumed by the applicable Menu/Operations paths; future Operations orders use collision-free configured numbering and immutable receipt/reason snapshots; historical order/receipt snapshots remain unchanged; existing catalog/Menu/Operations tests remain green.
- [ ] **Gate 3: Approval/audit** — sensitive commands can require recent acting-user re-PIN and/or be held for approval; second-person rules reject requester self-approval; approval/rejection with a distinct authorized approver executes at most once, remains recoverable across timeout/crash/retry, and a production runner independently drains READY/RETRYABLE/expired-lease jobs; immutable audit history is appended.
- [ ] **Gate 4: Inventory/purchasing** — the existing stock ledger is extended in place with historical/Operations compatibility preserved; Admin-origin adjustment/stocktake/waste/transfer/receiving/return movements converge into Operations local SQLite through a durable monotonic pull cursor and stale-inventory conflict fence; reservation lifecycle, weighted-average cost, stocktake, transfer, receiving, OWNER-only audited emergency negative adjustment, supplier-aware reorder calculations, and structured reason-code validation pass without ordinary negative-stock leakage.
- [ ] **Gate 5: Orders/CRM/delivery** — Admin cancellation and Operations lifecycle sync converge through canonical compare-and-swap revision authority; stale local outbox transitions cannot overwrite the canonical winner; order history remains immutable; refund events are separate; applicable cancellation/refund/discount/comp reasons use central code-plus-label snapshots rather than free-text classification; canonical phone identity and merge preserve history; delivery routing is shop-safe; loyalty/promotion rules are enforced atomically in both POS and ONLINE order placement with immutable applied-rule snapshots.
- [ ] **Gate 6: Workforce** — PIN/role changes, linked Operations-worker PIN coherence/collision checks, shop assignments, attendance corrections, leave, and staff-payment records are audited and permission-safe; the minimal finance-account/movement prerequisite exists before staff-payment acceptance; payment record + money movement + salary expense/reporting fact commit exactly once against a valid account and reconcile without double counting.
- [ ] **Gate 7: Finance/reports** — the existing finance core is extended without recreation; Operations remains the sole authority that closes canonical business days; Admin X is non-closing and Admin Z/history finalizes exactly once only from an already CLOSED Operations business day; non-zero cash variance/pay-in/pay-out use central structured reason snapshots; profit and money position are separately correct; staff salary expense is included exactly once; transfers do not become expenses; private expense receipts remain access-controlled; reports reconcile to source records.
- [ ] **Gate 8: WhatsApp/operations health** — WhatsApp control surfaces use the existing WhatsApp authority, live replies remain Operations-owned, system-event messages are idempotent, domain alerts are deduplicated/actionable, and device/shop health exposes no dangerous remote POS commands.
- [ ] **Gate 9: Approved-scope completion** — role-based Dashboard, catalog-image/bulk/archive workflows, recurring expenses, supplier payment state/attachments, CRM detail, special hours, appearance, privacy-safe push, and shared archive/delete behavior are covered by automated acceptance tests; supplier `UNPAID | PARTIALLY_PAID | PAID` and supplier balance reconcile to immutable supplier-payment allocations, purchase returns, and matching finance movements; concurrent distinct payment/return commands serialize against each PO payable and cannot over-allocate it.
- [ ] **Gate 10: Production** — root CI, migration tests, Menu/Operations/Admin E2E, accessibility gate, mobile Safari/Chrome acceptance, PWA install, exact separate-Vercel deployment-contract checks covering **every** `apps/admin/api/cron/*.ts` route/path/cadence/authentication contract, and real production smoke checks pass with no unresolved serious review finding.

## Completion Command Set

At each major merge checkpoint run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:migrations
npm run test:catalog-architecture
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run test:admin-security
npm run test:e2e
npm run build
```

At the final production gate also run the Admin-specific architecture, cross-app, deployment-contract, and accessibility checks introduced by the reliability/hardening plans.

Expected result: every applicable command exits `0`; any failure blocks the checkpoint until corrected.

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
6. `2026-09-10-tux-admin-workforce.md` — employee identity, shop assignments, shifts, attendance, leave, wage estimates, staff payment records.
7. `2026-09-10-tux-admin-finance-reports.md` — expenses, Bank & Cash, money movements, settlements, X/Z end-day history, cashier reconciliation, owner contributions/withdrawals, profit/COGS reporting, advanced report filters/drill-down/saved views/targets/owner summary.
8. `2026-09-10-tux-admin-whatsapp-operations.md` — WhatsApp control center, templates, quick replies, automatic order messages, analytics, health, plus opening/closing checklists, manager log, devices/printers/shop health.
9. `2026-09-10-tux-admin-approved-scope-completion.md` — role-adaptive Dashboard, dashboard customization, product image/bulk/archive completion, purchasing documents/payment state, recurring expenses, CRM detail, special hours, appearance, reusable UX states, and privacy-safe web push.
10. `2026-09-10-tux-admin-reliability-production.md` — concurrency hardening, durable idempotency, offline behavior, observability, cross-app regression gates, real-mobile acceptance, Vercel production rollout, and production smoke tests.

## Cross-Plan Interfaces

All plans depend on these stable interfaces established by Plan 1:

```ts
export type AdminRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
export type ShopScope = { kind: 'shop'; shopId: string } | { kind: 'all-shops' };
export type AdminSessionPrincipal = {
  employeeId: string;
  role: AdminRole;
  permissions: string[];
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

Every Admin BFF mutation uses a session principal resolved from the secure cookie and passes an explicit permission and shop requirement into the shared authorization helper before invoking an RPC or service operation.

## Master Verification Gates

- [ ] **Gate 1: Foundation** — `npm run build -w @tux/admin`, Admin typecheck/tests, PIN auth integration tests, and shop-isolation tests pass.
- [ ] **Gate 2: Catalog/config** — Admin publish updates canonical Menu catalog and Operations configuration in one accepted version; existing catalog and Menu tests remain green.
- [ ] **Gate 3: Approval/audit** — sensitive commands can be held for approval, approved/rejected with approver PIN, execute at most once, and append immutable audit history.
- [ ] **Gate 4: Inventory/purchasing** — stock ledger balances, reservation lifecycle, weighted-average cost, stocktake, transfer, and receiving tests pass without negative-stock leakage.
- [ ] **Gate 5: Orders/CRM/delivery** — order history remains immutable, refund events are separate, canonical phone identity and merge preserve history, and delivery routing is shop-safe.
- [ ] **Gate 6: Workforce** — PIN/role changes, shop assignments, attendance corrections, leave, and staff-payment records are audited and permission-safe.
- [ ] **Gate 7: Finance/reports** — profit and money position are separately correct, End Day snapshots are immutable, bank/cash transfers do not become expenses, and report summaries reconcile to drill-down source records.
- [ ] **Gate 8: WhatsApp/operations health** — WhatsApp control surfaces use the existing WhatsApp authority, live replies remain Operations-owned, and device/shop health is actionable without dangerous remote POS commands.
- [ ] **Gate 9: Approved-scope completion** — role-based Dashboard, catalog-image/bulk/archive workflows, recurring expenses, supplier payment state/attachments, CRM detail, special hours, appearance, and privacy-safe push are all covered by automated acceptance tests.
- [ ] **Gate 10: Production** — root CI, migration tests, Menu/Operations/Admin E2E, mobile Safari/Chrome acceptance, PWA install, and real production smoke checks pass with no unresolved serious review finding.

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
npm run test:e2e
npm run build
```

Expected result: every command exits `0`; any failure blocks the checkpoint until corrected.

# TUX Admin Finance, Bank & Cash, End Day, and Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver expenses, bank/cash money position, settlements, X/Z/end-day history, cashier reconciliation, owner capital movements, profit/COGS calculations, advanced reports, saved views, targets, and daily owner summaries.

**Architecture:** Preserve canonical orders/payments/expenses/business days and add explicit finance-event tables around them. Profit and money position are separate models: profit is earned performance, while bank/cash/wallet/pending-settlement balances change only from real money movements. End Day produces an immutable snapshot plus reconciliation; later corrections append adjustment events. Reports aggregate server-side from canonical events and drill down to their source records.

**Tech Stack:** PostgreSQL/Supabase RPCs and reporting views, TypeScript Admin BFF, React/TanStack Query, Recharts, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- `Net Sales - COGS - Expenses = Estimated Operating Profit` for the approved management profit model.
- Profit is never blindly added to bank balance.
- Transfers between tracked accounts change location of money, not profit or expenses.
- Owner contribution increases tracked funds but is not sales/profit; owner withdrawal reduces tracked funds but is not an operating expense.
- Historical payment/order/end-day snapshots are immutable; corrections are explicit adjustment records.
- Purchases increase inventory/cost basis and become COGS when consumed, not when purchased.
- Reports stay inside Admin; there is no import/export.

---

### Task 1: Add finance accounts, money movements, settlements, end-day snapshots, and recurring-expense schema

**Files:**
- Create: `supabase/migrations/20260910210000_admin_finance.sql`
- Create: `scripts/test-admin-finance-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `finance_accounts`, `finance_movements`, `payment_settlements`, `expense_categories`, `recurring_expense_rules`, `end_day_snapshots`, `cashier_reconciliations`, `financial_adjustments`.
- Produces RPCs: `post_finance_movement_v1`, `transfer_finance_account_v1`, `close_business_day_finance_v1`, `post_financial_adjustment_v1`.

- [ ] **Step 1: Write the failing migration test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910210000_admin_finance.sql', 'utf8').toLowerCase();
for (const name of ['finance_accounts','finance_movements','payment_settlements','end_day_snapshots','cashier_reconciliations','financial_adjustments']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-finance-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement event-based finance schema**

```sql
create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shop_id uuid references public.shops(id),
  account_type text not null check (account_type in ('CASH','BANK','WALLET','PENDING_SETTLEMENT')),
  name text not null,
  active boolean not null default true,
  opening_balance_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shop_id uuid references public.shops(id),
  account_id uuid not null references public.finance_accounts(id),
  movement_type text not null check (movement_type in ('OPENING_FLOAT','SALE','REFUND','PAY_IN','PAY_OUT','EXPENSE','BANK_DEPOSIT','TRANSFER_IN','TRANSFER_OUT','SETTLEMENT','BANK_FEE','OWNER_CONTRIBUTION','OWNER_WITHDRAWAL','STAFF_PAYMENT','ADJUSTMENT')),
  amount_minor bigint not null,
  command_id uuid not null,
  source_type text,
  source_id text,
  actor_employee_id uuid references public.business_employees(id),
  created_at timestamptz not null default now(),
  unique (account_id, command_id, movement_type)
);
```

The account-transfer RPC must create equal/opposite transfer movements in one transaction. End Day must lock the open business day, snapshot sales/payments/COGS/expenses/profit, record cashier/shop cash reconciliation, and close once.

- [ ] **Step 4: Verify migration suite**

```bash
node scripts/test-admin-finance-migration.mjs
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910210000_admin_finance.sql scripts/test-admin-finance-migration.mjs package.json
git commit -m "feat(admin): add finance accounts and end-day model"
```

### Task 2: Implement finance calculations and Bank & Cash service

**Files:**
- Create: `packages/admin-contracts/src/finance.ts`
- Create: `apps/admin/server/finance/profit.ts`
- Create: `apps/admin/server/finance/financeService.ts`
- Create: `apps/admin/api/admin/finance.ts`
- Test: `apps/admin/server/finance/profit.test.ts`
- Test: `apps/admin/server/finance/financeService.test.ts`

**Interfaces:**
- Produces `ProfitSummary`, `MoneyPosition`, `FinanceAccountBalance`, `transferMoney`, `recordOwnerContribution`, `recordOwnerWithdrawal`, `recordExpense`, `recordSettlement`.

- [ ] **Step 1: Write failing profit/money-position tests**

```ts
it('separates operating profit from account balances', () => {
  const profit = calculateOperatingProfit({ netSalesMinor: 3_100_000, cogsMinor: 1_050_000, expensesMinor: 420_000 });
  expect(profit).toBe(1_630_000);
  expect(calculateTrackedFunds([{ balanceMinor: 18_540_000 }, { balanceMinor: 1_425_000 }, { balanceMinor: 2_260_000 }])).toBe(22_225_000);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/finance/profit.test.ts apps/admin/server/finance/financeService.test.ts
```

Expected: fail before implementation.

- [ ] **Step 3: Implement deterministic financial calculations**

```ts
export const calculateOperatingProfit = ({ netSalesMinor, cogsMinor, expensesMinor }: { netSalesMinor: number; cogsMinor: number; expensesMinor: number }) =>
  netSalesMinor - cogsMinor - expensesMinor;
export const calculateTrackedFunds = (accounts: { balanceMinor: number }[]) =>
  accounts.reduce((sum, account) => sum + account.balanceMinor, 0);
```

A settlement moves value from `PENDING_SETTLEMENT` to BANK/WALLET and may post a separate BANK_FEE expense/movement for the difference. Expense posting must identify the payment account only when the expense is actually paid from a tracked account.

- [ ] **Step 4: Verify finance tests/typecheck**

```bash
npx vitest run apps/admin/server/finance/profit.test.ts apps/admin/server/finance/financeService.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/finance.ts apps/admin/server/finance apps/admin/api/admin/finance.ts
git commit -m "feat(admin): add finance and money-position service"
```

### Task 3: Build Finance, Bank & Cash, Expenses, and money-movement UI

**Files:**
- Create: `apps/admin/src/finance/FinancePage.tsx`
- Create: `apps/admin/src/finance/BankCashPage.tsx`
- Create: `apps/admin/src/finance/FinanceAccountPage.tsx`
- Create: `apps/admin/src/finance/TransferMoneySheet.tsx`
- Create: `apps/admin/src/finance/ExpensesPage.tsx`
- Create: `apps/admin/src/finance/AddExpenseSheet.tsx`
- Create: `apps/admin/src/finance/SettlementsPage.tsx`
- Test: `apps/admin/src/finance/BankCashPage.test.tsx`
- E2E: `e2e/admin-finance.spec.ts`

**Interfaces:**
- Produces current Bank/Cash/Wallet/Pending balances, transaction history, transfers, deposits, owner movements, expenses, settlements.

- [ ] **Step 1: Write failing money-position UI test**

```tsx
it('shows profit and tracked money as separate figures', () => {
  render(<FinancePage summary={{ estimatedProfitMinor: 1_630_000, trackedFundsMinor: 22_225_000 }} />);
  expect(screen.getByText('Estimated Operating Profit')).toBeTruthy();
  expect(screen.getByText('Total Tracked Money')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/finance/BankCashPage.test.tsx
```

Expected: fail before screens exist.

- [ ] **Step 3: Implement finance screens with explicit movement semantics**

Transfer UI must show From, To, Amount, Reason and explain that transfer does not change profit. Owner Contribution/Withdrawal must be separate actions from Expense. Account detail shows opening/current balance plus money-in/out history and source links.

- [ ] **Step 4: Verify E2E**

```bash
npx vitest run apps/admin/src/finance/BankCashPage.test.tsx
npx playwright test e2e/admin-finance.spec.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/finance e2e/admin-finance.spec.ts
git commit -m "feat(admin): add finance bank and cash UI"
```

### Task 4: Implement X Report, Z/End Day, cashier reconciliation, and immutable day history

**Files:**
- Create: `packages/admin-contracts/src/endDay.ts`
- Create: `apps/admin/server/finance/endDayService.ts`
- Create: `apps/admin/src/finance/EndDayPage.tsx`
- Create: `apps/admin/src/finance/EndDayHistoryPage.tsx`
- Create: `apps/admin/src/finance/CashierReconciliation.tsx`
- Test: `apps/admin/server/finance/endDayService.test.ts`
- E2E: `e2e/admin-end-day.spec.ts`

**Interfaces:**
- Produces non-closing X report and immutable Z/End-Day snapshot with expected/actual cash and per-cashier variance.

- [ ] **Step 1: Write failing close-once test**

```ts
it('does not create two Z snapshots for one business day', async () => {
  await service.closeDay(closeInput, owner);
  const second = await service.closeDay(closeInput, owner);
  expect(second).toMatchObject({ ok: false, code: 'business_day_already_closed' });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/finance/endDayService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement X/Z and cashier accountability**

X reads current sales/payment/refund/discount/cash-in-out totals without closing. Z freezes business-day financial totals, COGS, expenses, estimated profit, payment breakdown, expected/actual cash, cash variance, deposits/transfers, closing cash, and bank/wallet position. Corrections append financial adjustments and show Original, Adjustment, Adjusted values.

- [ ] **Step 4: Verify End Day integration**

```bash
npx vitest run apps/admin/server/finance/endDayService.test.ts
npx playwright test e2e/admin-end-day.spec.ts
npm test
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/endDay.ts apps/admin/server/finance/endDayService.ts apps/admin/src/finance e2e/admin-end-day.spec.ts
git commit -m "feat(admin): add X Z and End Day finance history"
```

### Task 5: Add reporting query layer, contextual filters, comparison, saved views, and drill-down

**Files:**
- Create: `supabase/migrations/20260910220000_admin_reporting.sql`
- Create: `packages/admin-contracts/src/reports.ts`
- Create: `apps/admin/server/reports/reportService.ts`
- Create: `apps/admin/api/admin/reports.ts`
- Create: `apps/admin/src/reports/ReportsPage.tsx`
- Create: `apps/admin/src/reports/ReportFilters.tsx`
- Create: `apps/admin/src/reports/ReportView.tsx`
- Create: `apps/admin/src/reports/SavedViews.tsx`
- Test: `apps/admin/server/reports/reportService.test.ts`
- E2E: `e2e/admin-reports.spec.ts`

**Interfaces:**
- Produces reports for Sales, Profit/COGS, Products, Inventory, Waste, Purchasing, Customers, Promotions, Payments, Expenses, Staff, Delivery, Refunds/Returns, Shop Comparison, Tax/Service Charges, Cash/End Day, Bank & Cash, Margin Variance, Actual-vs-Theoretical.

- [ ] **Step 1: Write failing filter/reconciliation test**

```ts
it('reconciles sales drill-down total to the summary', async () => {
  const report = await service.sales({ shops: ['s1'], from: '2026-09-01', to: '2026-09-30' }, owner);
  expect(report.rows.reduce((sum, row) => sum + row.netSalesMinor, 0)).toBe(report.summary.netSalesMinor);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/reports/reportService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement server-side reporting and saved filter views**

Filters are contextual and may include Date, Shop, Source, Order Type, Payment, Employee, Customer, Product, Category, Promotion, Supplier, Delivery Zone, and Status. Comparison supports previous period/week/month/year. Saved views persist filter/layout preferences inside Admin only. Every summary metric with a meaningful source path must support drill-down to underlying records.

- [ ] **Step 4: Verify report E2E and performance**

```bash
npx vitest run apps/admin/server/reports/reportService.test.ts
npx playwright test e2e/admin-reports.spec.ts
```

Expected: report pages paginate/server-filter instead of loading all historical rows; tests exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910220000_admin_reporting.sql packages/admin-contracts/src/reports.ts apps/admin/server/reports apps/admin/api/admin/reports.ts apps/admin/src/reports e2e/admin-reports.spec.ts
git commit -m "feat(admin): add advanced business reporting"
```

### Task 6: Add targets and daily Owner Summary

**Files:**
- Create: `apps/admin/server/reports/targets.ts`
- Create: `apps/admin/server/reports/ownerSummary.ts`
- Create: `apps/admin/src/dashboard/TargetsPanel.tsx`
- Create: `apps/admin/src/dashboard/OwnerSummaryCard.tsx`
- Create: `apps/admin/api/cron/admin-owner-summary.ts`
- Test: `apps/admin/server/reports/ownerSummary.test.ts`

**Interfaces:**
- Produces configurable sales/order/food-cost/waste targets and concise daily owner summaries after shops close.

- [ ] **Step 1: Write failing owner-summary test**

```ts
it('includes profit, cash variance, waste and unresolved operational exceptions', async () => {
  const summary = await buildOwnerSummary(fixtureDay);
  expect(summary).toMatchObject({ netSalesMinor: expect.any(Number), estimatedProfitMinor: expect.any(Number), cashVarianceMinor: expect.any(Number) });
  expect(summary.sections).toContain('Inventory');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/reports/ownerSummary.test.ts
```

Expected: fail before implementation.

- [ ] **Step 3: Implement summary and target calculations**

Owner summary must be generated from canonical server data, not precomputed client cards, and include key sales/orders/profit/cash variance/stock issues/major refunds/online-order failures/operational exceptions. It remains available in Admin even when WhatsApp is not configured.

- [ ] **Step 4: Verify tests**

```bash
npx vitest run apps/admin/server/reports/ownerSummary.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/reports apps/admin/src/dashboard apps/admin/api/cron/admin-owner-summary.ts
git commit -m "feat(admin): add targets and daily owner summary"
```

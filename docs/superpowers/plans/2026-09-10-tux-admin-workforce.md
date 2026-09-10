# TUX Admin Workforce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver global employee identity, shop assignments, role/permission management, shifts, attendance, leave, wage estimates, and auditable staff-payment records.

**Architecture:** Introduce business-level employees that map safely to existing shop-scoped worker/session activity. Admin manages identity, access, schedule, attendance corrections, leave, and pay metadata; Operations remains the authority for live worker activity. Before staff-payment implementation, establish the minimal generic `finance_accounts`/`finance_movements` core required to validate payment accounts and post staff payments atomically. Staff payments then create finance-linked movements rather than silently changing bank/cash balances. The following Finance plan extends this same core additively.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, React/TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- One business employee identity per person even when assigned to multiple shops.
- Shop assignments are explicit; every shift and attendance record is shop-scoped.
- Existing worker/order/business-day references remain valid.
- Attendance corrections preserve original values and append audit history.
- Pay types are hourly or monthly; TUX provides wage estimates, not tax/payroll filing.
- Suspending a person removes authorized Admin/Operations access where applicable without deleting history.
- Staff payment acceptance is not allowed until the finance account/movement prerequisite below is migrated and verified. Every staff payment references an active valid account and atomically commits both its immutable payment record and one idempotent `STAFF_PAYMENT` finance movement.
- The finance prerequisite is shared infrastructure only. Do not implement broader Bank & Cash, settlements, End Day, reports, owner movements, or recurring expenses in Workforce; those remain Plan 7/approved-scope work.

---

### Task 0: Establish the minimal finance account/movement prerequisite

**Files:**
- Create: `supabase/migrations/20260910195000_admin_finance_core.sql`
- Create: `scripts/test-admin-finance-core-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces shared tables: `finance_accounts`, `finance_movements`.
- Produces trusted RPC: `post_finance_movement_v1` for server-side idempotent posting; Workforce may call the same underlying transactional primitive from `record_staff_payment_v1`.

- [ ] **Step 1: Write the failing finance-core migration test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910195000_admin_finance_core.sql', 'utf8').toLowerCase();
for (const name of ['finance_accounts', 'finance_movements', 'post_finance_movement_v1', "'staff_payment'"]) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
for (const table of ['finance_accounts', 'finance_movements']) {
  if (!sql.includes(`alter table public.${table} enable row level security`)) throw new Error(`missing RLS for ${table}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-finance-core-migration.mjs
```

Expected: ENOENT before the prerequisite migration exists.

- [ ] **Step 3: Implement the generic finance core only**

```sql
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shop_id uuid references public.shops(id),
  account_type text not null check (account_type in ('CASH','BANK','WALLET','PENDING_SETTLEMENT')),
  name text not null,
  active boolean not null default true,
  opening_balance_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_movements (
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

Keep this migration additive and domain-neutral. Enable RLS with no permissive browser policies, revoke direct `anon`/`authenticated` access, and expose finance posting only through trusted Admin server/service-role RPCs. Enforce business/shop consistency between account, movement, and actor scope. This task does **not** seed fictional balances or implement transfer/settlement/end-day/reporting behavior.

- [ ] **Step 4: Verify the prerequisite and migration chain**

```bash
node scripts/test-admin-finance-core-migration.mjs
npm run test:migrations
```

Expected: exit `0`; finance core exists before Workforce schema, is browser-deny-by-default, and existing Operations/Menu migrations remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910195000_admin_finance_core.sql scripts/test-admin-finance-core-migration.mjs package.json
git commit -m "feat(admin): add finance core prerequisite"
```

### Task 1: Add workforce schema and existing-worker mapping

**Files:**
- Create: `supabase/migrations/20260910200000_admin_workforce.sql`
- Create: `scripts/test-admin-workforce-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `employee_worker_links`, `employee_compensation`, `employee_shifts`, `attendance_events`, `attendance_corrections`, `leave_requests`, `staff_payment_records`.
- Produces RPCs: `assign_employee_to_shop_v1`, `suspend_employee_v1`, `correct_attendance_v1`, `record_staff_payment_v1`.

- [ ] **Step 1: Write the failing migration test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910200000_admin_workforce.sql', 'utf8').toLowerCase();
for (const name of ['employee_worker_links','employee_shifts','attendance_events','attendance_corrections','leave_requests','staff_payment_records','record_staff_payment_v1']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
for (const token of ['finance_account_id', 'finance_movements', "'staff_payment'"]) {
  if (!sql.includes(token)) throw new Error(`staff payment finance linkage missing ${token}`);
}
```

Extend the executable migration test to prove `staff_payment_records.finance_account_id` references the pre-existing `finance_accounts` core, rejects an account from another business/shop scope, and that one `record_staff_payment_v1` call atomically inserts the payment record plus exactly one `STAFF_PAYMENT` movement for its command id.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-workforce-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement workforce schema with preserved history**

```sql
create table public.employee_worker_links (
  employee_id uuid not null references public.business_employees(id),
  shop_id uuid not null references public.shops(id),
  worker_id uuid not null references public.workers(id),
  primary key (employee_id, shop_id),
  unique (shop_id, worker_id)
);

create table public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.business_employees(id),
  shop_id uuid not null references public.shops(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0,
  status text not null default 'SCHEDULED',
  version bigint not null default 1,
  check (ends_at > starts_at)
);
```

`staff_payment_records` must contain an explicit `finance_account_id` foreign key to `finance_accounts`, pay period, amount, payment date, actor, and idempotent command id. `record_staff_payment_v1` must verify the account is active and belongs to the employee/payment shop's business scope, then insert the immutable staff-payment record and matching `finance_movements` row with `movement_type='STAFF_PAYMENT'` in the **same database transaction**. A duplicate command id must return the existing deterministic result without a second payment or movement.

Backfill links only where existing worker identity can be matched deterministically; ambiguous records remain unmapped for explicit Admin review rather than guessed.

- [ ] **Step 4: Verify migration suite**

```bash
node scripts/test-admin-workforce-migration.mjs
npm run test:migrations
```

Expected: exit `0`, including finance-account FK/scope validation and atomic/idempotent staff-payment posting.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910200000_admin_workforce.sql scripts/test-admin-workforce-migration.mjs package.json
git commit -m "feat(admin): add workforce schema"
```

### Task 2: Add workforce contracts and trusted service

**Files:**
- Create: `packages/admin-contracts/src/staff.ts`
- Create: `apps/admin/server/staff/staffService.ts`
- Create: `apps/admin/api/admin/staff.ts`
- Test: `apps/admin/server/staff/staffService.test.ts`

**Interfaces:**
- Produces `EmployeeDetail`, `Shift`, `AttendanceSummary`, `LeaveRequest`, `WageEstimate`, `StaffPaymentRecord` and commands for identity/shop/role/status/schedule/attendance/pay.

- [ ] **Step 1: Write failing attendance-correction and staff-payment tests**

```ts
it('preserves original attendance while recording the correction', async () => {
  await service.correctAttendance({ eventId: 'e1', correctedAt: '2026-09-10T06:00:00Z', reason: 'Forgot to clock in' }, manager);
  expect(store.updateOriginalEvent).not.toHaveBeenCalled();
  expect(store.insertCorrection).toHaveBeenCalledTimes(1);
});

it('records staff payment against an explicit finance account exactly once', async () => {
  const command = { commandId: 'cmd-pay-1', employeeId: 'e1', financeAccountId: 'cash-1', amountMinor: 120000, payPeriod: '2026-09' };
  await service.recordPayment(command, payrollManager);
  await service.recordPayment(command, payrollManager);
  expect(store.staffPaymentCount('cmd-pay-1')).toBe(1);
  expect(store.financeMovementCount('cmd-pay-1', 'STAFF_PAYMENT')).toBe(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/staff/staffService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement permission/shop-safe staff commands**

Role/PIN/permission changes require `staff.manage` and route through approval rules when configured. Attendance correction requires `staff.manage` plus reason. Staff-payment recording requires `staff.payments`, an explicit valid payment account, pay period, amount, and idempotent command id. The service delegates the payment write to `record_staff_payment_v1`; it must not separately write a staff record and then dispatch finance posting from TypeScript because that would break atomicity.

- [ ] **Step 4: Verify unit/type tests**

```bash
npx vitest run apps/admin/server/staff/staffService.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/staff.ts apps/admin/server/staff apps/admin/api/admin/staff.ts
git commit -m "feat(admin): add workforce service"
```

### Task 3: Build Staff, Schedule, Attendance, Leave, and Pay UI

**Files:**
- Create: `apps/admin/src/staff/StaffPage.tsx`
- Create: `apps/admin/src/staff/EmployeeDetailPage.tsx`
- Create: `apps/admin/src/staff/SchedulePage.tsx`
- Create: `apps/admin/src/staff/AttendancePage.tsx`
- Create: `apps/admin/src/staff/LeavePage.tsx`
- Create: `apps/admin/src/staff/StaffPaymentPage.tsx`
- Create: `apps/admin/src/staff/PermissionsEditor.tsx`
- Test: `apps/admin/src/staff/EmployeeDetailPage.test.tsx`
- E2E: `e2e/admin-workforce.spec.ts`

**Interfaces:**
- Produces phone-first staff profile with progressive disclosure and desktop/tablet adaptive management.

- [ ] **Step 1: Write failing progressive-disclosure test**

```tsx
it('keeps pay and permissions behind explicit detail actions', () => {
  render(<EmployeeDetailPage employee={fixtureEmployee} />);
  expect(screen.getByText('Schedule')).toBeTruthy();
  expect(screen.getByText('Attendance')).toBeTruthy();
  expect(screen.getByText('Pay')).toBeTruthy();
  expect(screen.getByText('Permissions')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/staff/EmployeeDetailPage.test.tsx
```

Expected: fail before components exist.

- [ ] **Step 3: Implement workforce screens**

Schedule supports add/edit/remove shift, assign shop, and Copy Previous Week. Attendance shows scheduled/actual, break, worked hours, late/absent/left-early/overtime indicators, with corrections as separate audited actions. Leave supports Vacation/Sick/Unpaid/Other with Approve/Reject. Staff payment screen records expected/paid amount, account, date, and pay period; account choices come from the verified finance core and never accept an arbitrary account id outside the employee/payment scope.

- [ ] **Step 4: Verify workforce E2E**

```bash
npx vitest run apps/admin/src/staff/EmployeeDetailPage.test.tsx
npx playwright test e2e/admin-workforce.spec.ts
```

Expected: exit `0`, including staff payment against a valid account and rejection of cross-scope/inactive accounts.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/staff e2e/admin-workforce.spec.ts
git commit -m "feat(admin): add workforce management UI"
```

### Task 4: Add attendance/wage calculations and factual staff metrics

**Files:**
- Create: `apps/admin/server/staff/timekeeping.ts`
- Create: `apps/admin/server/staff/wages.ts`
- Create: `apps/admin/src/staff/StaffMetricsPanel.tsx`
- Test: `apps/admin/server/staff/timekeeping.test.ts`
- Test: `apps/admin/server/staff/wages.test.ts`

**Interfaces:**
- Produces `calculateWorkedMinutes`, `calculateOvertimeMinutes`, `estimateHourlyWage`, `estimateMonthlyWage`.

- [ ] **Step 1: Write failing wage tests**

```ts
it('subtracts break minutes from worked time', () => {
  expect(calculateWorkedMinutes({ clockIn: '09:00', clockOut: '17:00', breakMinutes: 40 })).toBe(440);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/staff/timekeeping.test.ts apps/admin/server/staff/wages.test.ts
```

Expected: fail before calculation modules exist.

- [ ] **Step 3: Implement deterministic calculations and factual metrics**

```ts
export const estimateHourlyWage = (regularMinutes: number, overtimeMinutes: number, hourlyMinor: number, multiplier: number) =>
  Math.round((regularMinutes / 60) * hourlyMinor + (overtimeMinutes / 60) * hourlyMinor * multiplier);
```

Metrics may include orders handled, sales handled, cancellations/refunds initiated, attendance, and late shifts. Do not create an arbitrary employee score/ranking.

- [ ] **Step 4: Verify tests**

```bash
npx vitest run apps/admin/server/staff/timekeeping.test.ts apps/admin/server/staff/wages.test.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/staff apps/admin/src/staff/StaffMetricsPanel.tsx
git commit -m "feat(admin): add workforce time and wage calculations"
```
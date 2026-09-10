# TUX Admin Workforce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver global employee identity, shop assignments, role/permission management, shifts, attendance, leave, wage estimates, and auditable staff-payment records.

**Architecture:** Introduce business-level employees that map safely to existing shop-scoped worker/session activity. Admin manages identity, access, schedule, attendance corrections, leave, and pay metadata; Operations remains the authority for live worker activity. Staff payments create finance-linked movements rather than silently changing bank/cash balances.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, React/TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- One business employee identity per person even when assigned to multiple shops.
- Shop assignments are explicit; every shift and attendance record is shop-scoped.
- Existing worker/order/business-day references remain valid.
- Attendance corrections preserve original values and append audit history.
- Pay types are hourly or monthly; TUX provides wage estimates, not tax/payroll filing.
- Suspending a person removes authorized Admin/Operations access where applicable without deleting history.

---

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
for (const name of ['employee_worker_links','employee_shifts','attendance_events','attendance_corrections','leave_requests','staff_payment_records']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

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

Backfill links only where existing worker identity can be matched deterministically; ambiguous records remain unmapped for explicit Admin review rather than guessed.

- [ ] **Step 4: Verify migration suite**

```bash
node scripts/test-admin-workforce-migration.mjs
npm run test:migrations
```

Expected: exit `0`.

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

- [ ] **Step 1: Write failing attendance-correction test**

```ts
it('preserves original attendance while recording the correction', async () => {
  await service.correctAttendance({ eventId: 'e1', correctedAt: '2026-09-10T06:00:00Z', reason: 'Forgot to clock in' }, manager);
  expect(store.updateOriginalEvent).not.toHaveBeenCalled();
  expect(store.insertCorrection).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/staff/staffService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement permission/shop-safe staff commands**

Role/PIN/permission changes require `staff.manage` and route through approval rules when configured. Attendance correction requires `staff.manage` plus reason. Staff-payment recording requires `staff.payments`, an explicit payment account, pay period, amount, and idempotent command id.

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

Schedule supports add/edit/remove shift, assign shop, and Copy Previous Week. Attendance shows scheduled/actual, break, worked hours, late/absent/left-early/overtime indicators, with corrections as separate audited actions. Leave supports Vacation/Sick/Unpaid/Other with Approve/Reject. Staff payment screen records expected/paid amount, account, date, and pay period.

- [ ] **Step 4: Verify workforce E2E**

```bash
npx vitest run apps/admin/src/staff/EmployeeDetailPage.test.tsx
npx playwright test e2e/admin-workforce.spec.ts
```

Expected: exit `0`.

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

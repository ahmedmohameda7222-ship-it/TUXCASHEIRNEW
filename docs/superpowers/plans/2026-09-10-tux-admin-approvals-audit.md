# TUX Admin Approvals and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the immutable audit ledger and one-time approval engine required by every sensitive Admin domain.

**Architecture:** Sensitive commands use a shared server policy evaluator before execution. If approval is required, the original command payload is canonicalized and stored with its requested action, requester, shop, threshold context, and idempotency key; an authorized approver re-enters PIN and approves/rejects. Approved commands execute exactly once and append immutable audit events. Normal non-sensitive commands also append audit events after successful commit.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, `@tux/admin-contracts`, React/TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Audit events are immutable and cannot be edited/deleted through Admin.
- Approval rejection never executes the requested business action.
- Approval acceptance executes the requested command at most once.
- Approver must have the required approval permission and shop scope and must confirm with their own PIN.
- Audit records include actor, role, shop, action/entity, old/new values where meaningful, reason, timestamp, session/device context, and approval linkage.
- Normal page views are not noisy audit events; important business mutations are.

---

### Task 1: Add audit and approval schema

**Files:**
- Create: `supabase/migrations/20260910125000_admin_approvals_audit.sql`
- Create: `scripts/test-admin-approvals-audit-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `admin_audit_events`, `admin_approval_rules`, `admin_approval_requests`.
- Produces RPCs: `create_admin_approval_request_v1`, `decide_admin_approval_request_v1`, `append_admin_audit_event_v1`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910125000_admin_approvals_audit.sql', 'utf8').toLowerCase();
for (const name of ['admin_audit_events','admin_approval_rules','admin_approval_requests','decide_admin_approval_request_v1']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
if (sql.includes('delete from public.admin_audit_events')) throw new Error('audit history must not expose destructive deletion');
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-approvals-audit-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement immutable audit and approval state model**

```sql
create table public.admin_approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shop_id uuid references public.shops(id),
  requester_employee_id uuid not null references public.business_employees(id),
  action_type text not null,
  command_id uuid not null,
  command_payload jsonb not null,
  reason text,
  status text not null check (status in ('PENDING','APPROVED','REJECTED','EXECUTED','FAILED')),
  approver_employee_id uuid references public.business_employees(id),
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, command_id)
);

create table public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  shop_id uuid references public.shops(id),
  actor_employee_id uuid not null references public.business_employees(id),
  action_type text not null,
  entity_type text,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reason text,
  approval_request_id uuid references public.admin_approval_requests(id),
  session_id uuid references public.admin_sessions(id),
  created_at timestamptz not null default now()
);
```

Do not grant update/delete authority on `admin_audit_events` to browser roles. Approval decision RPC must use row locking and reject second decisions after status leaves PENDING.

- [ ] **Step 4: Verify migration suite**

```bash
node scripts/test-admin-approvals-audit-migration.mjs
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910125000_admin_approvals_audit.sql scripts/test-admin-approvals-audit-migration.mjs package.json
git commit -m "feat(admin): add approvals and immutable audit schema"
```

### Task 2: Implement shared approval policy and audit services

**Files:**
- Create: `packages/admin-contracts/src/approvals.ts`
- Create: `packages/admin-contracts/src/audit.ts`
- Modify: `packages/admin-contracts/src/index.ts`
- Create: `apps/admin/server/approvals/approvalService.ts`
- Create: `apps/admin/server/audit/auditService.ts`
- Test: `apps/admin/server/approvals/approvalService.test.ts`

**Interfaces:**
- Produces: `evaluateApprovalRequirement`, `requestApproval`, `approveRequest`, `rejectRequest`, `appendAuditEvent`.

- [ ] **Step 1: Write failing one-time execution tests**

```ts
it('does not execute an approved request twice', async () => {
  await service.approve({ requestId: 'r1', pin: '482731' }, owner);
  await service.approve({ requestId: 'r1', pin: '482731' }, owner);
  expect(executor.execute).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/approvals/approvalService.test.ts
```

Expected: fail before service implementation.

- [ ] **Step 3: Implement policy evaluation and audit append**

```ts
export type ApprovalDecision =
  | { required: false }
  | { required: true; ruleId: string; approverPermission: string };
```

Policy evaluation receives action type, actor, shop, amount/value impact, and configured threshold. `approveRequest` re-verifies approver PIN, checks `approvals.review` plus action-specific approval permission, locks the request, executes the stored command through the registered command executor once, marks EXECUTED, and appends the decision/business audit records.

- [ ] **Step 4: Verify service tests/typecheck**

```bash
npx vitest run apps/admin/server/approvals/approvalService.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/approvals.ts packages/admin-contracts/src/audit.ts packages/admin-contracts/src/index.ts apps/admin/server/approvals apps/admin/server/audit
git commit -m "feat(admin): add shared approval and audit services"
```

### Task 3: Add approvals/audit BFF and mobile UI

**Files:**
- Create: `apps/admin/api/admin/approvals.ts`
- Create: `apps/admin/api/admin/audit.ts`
- Create: `apps/admin/src/approvals/ApprovalsPage.tsx`
- Create: `apps/admin/src/approvals/ApprovalDetailPage.tsx`
- Create: `apps/admin/src/approvals/RePinDialog.tsx`
- Create: `apps/admin/src/audit/AuditPage.tsx`
- Create: `apps/admin/src/audit/AuditDetailPage.tsx`
- Test: `apps/admin/src/approvals/ApprovalDetailPage.test.tsx`
- E2E: `e2e/admin-approvals-audit.spec.ts`

**Interfaces:**
- Produces pending approval list, one-tap Approve/Reject then PIN confirmation, and human-readable audit history.

- [ ] **Step 1: Write failing approval UX test**

```tsx
it('requires PIN confirmation after Approve is chosen', () => {
  render(<ApprovalDetailPage request={fixtureRequest} />);
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByText('Enter PIN')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/approvals/ApprovalDetailPage.test.tsx
```

Expected: fail before UI exists.

- [ ] **Step 3: Implement permission-aware approval and audit screens**

Approval details show requester, shop, action, amount/value, reason, and consequences before decision. Audit details render structured before/after values in human terms; raw JSON is never the default presentation. Filters include date, shop, actor, action, entity, and approval status.

- [ ] **Step 4: Verify E2E**

```bash
npx vitest run apps/admin/src/approvals/ApprovalDetailPage.test.tsx
npx playwright test e2e/admin-approvals-audit.spec.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/api/admin/approvals.ts apps/admin/api/admin/audit.ts apps/admin/src/approvals apps/admin/src/audit e2e/admin-approvals-audit.spec.ts
git commit -m "feat(admin): add approval and audit management UI"
```

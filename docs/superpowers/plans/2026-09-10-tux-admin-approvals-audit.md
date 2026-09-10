# TUX Admin Approvals and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the immutable audit ledger and one-time approval engine required by every sensitive Admin domain.

**Architecture:** Sensitive commands use a shared server policy evaluator before execution. If approval is required, the original command payload is canonicalized and stored with its requested action, requester, shop, threshold context, and idempotency key; an authorized approver re-enters PIN and approves/rejects. Approval decision and command execution are never coupled only by an in-memory/serverless process. SQL-backed commands execute with the approval transition in one database transaction where feasible; other commands create a durable execution job/lease atomically with approval and retry through the command-idempotency boundary until a terminal result is durably recorded. Approved commands therefore produce the business effect at most once even across timeout/crash/retry. Normal non-sensitive commands also append audit events after successful commit.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, `@tux/admin-contracts`, React/TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Audit events are immutable and cannot be edited/deleted through Admin.
- Approval rejection never executes the requested business action.
- Approval acceptance executes the requested command at most once.
- Approval execution must be recoverable after request timeout, function crash, or process restart; a database row lock held by one serverless request is not sufficient protection around an independently dispatched command.
- Every externally executed approved command uses its persisted `command_id` as the idempotency key. Retrying after an ambiguous timeout must converge on the already-committed result rather than create a second business effect.
- Approver must have the required approval permission and shop scope and must confirm with their own PIN.
- Audit records include actor, role, shop, action/entity, old/new values where meaningful, reason, timestamp, session/device context, and approval linkage.
- Normal page views are not noisy audit events; important business mutations are.

---

### Task 1: Add audit, approval, and durable execution schema

**Files:**
- Create: `supabase/migrations/20260910125000_admin_approvals_audit.sql`
- Create: `scripts/test-admin-approvals-audit-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `admin_audit_events`, `admin_approval_rules`, `admin_approval_requests`, `admin_approval_execution_jobs`.
- Produces RPCs: `create_admin_approval_request_v1`, `decide_admin_approval_request_v1`, `claim_admin_approval_execution_v1`, `complete_admin_approval_execution_v1`, `append_admin_audit_event_v1`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910125000_admin_approvals_audit.sql', 'utf8').toLowerCase();
for (const name of [
  'admin_audit_events',
  'admin_approval_rules',
  'admin_approval_requests',
  'admin_approval_execution_jobs',
  'decide_admin_approval_request_v1',
  'claim_admin_approval_execution_v1',
  'complete_admin_approval_execution_v1',
]) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
if (sql.includes('delete from public.admin_audit_events')) throw new Error('audit history must not expose destructive deletion');
for (const token of ['command_id', 'lease_expires_at', 'attempt_count']) {
  if (!sql.includes(token)) throw new Error(`durable approval execution missing ${token}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-approvals-audit-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement immutable audit, approval, and durable execution state model**

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
  status text not null check (status in ('PENDING','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED')),
  approver_employee_id uuid references public.business_employees(id),
  decided_at timestamptz,
  executed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, command_id)
);

create table public.admin_approval_execution_jobs (
  approval_request_id uuid primary key references public.admin_approval_requests(id),
  business_id uuid not null references public.businesses(id),
  command_id uuid not null unique,
  state text not null check (state in ('READY','CLAIMED','RETRYABLE','EXECUTED','FAILED')),
  claim_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

Do not grant update/delete authority on `admin_audit_events` to browser roles. Approval decision RPC must use row locking and reject a second decision after status leaves PENDING. For an approved command that cannot be executed wholly inside the same SQL transaction, `decide_admin_approval_request_v1` must atomically transition the request to APPROVED and insert exactly one durable execution job keyed by the same `command_id`.

`claim_admin_approval_execution_v1` must atomically claim only READY/RETRYABLE work or reclaim an expired lease, issue a non-persisted claim token whose stored representation is hashed, increment `attempt_count`, and move the request/job to an executing/claimed state. A live lease cannot be stolen. `complete_admin_approval_execution_v1` accepts only the current claim, records the deterministic command result, transitions request/job to EXECUTED exactly once, and appends the linked audit event in the same transaction. Retryable infrastructure failures release/requeue the durable job; terminal business failures transition to FAILED with a safe error code. No crash path may require an operator to guess whether the underlying command ran.

For commands implemented as one trusted PostgreSQL RPC, prefer a single transaction that verifies approval, applies the command idempotently, records EXECUTED, and appends audit history atomically instead of creating an unnecessary asynchronous gap.

- [ ] **Step 4: Verify migration suite**

```bash
node scripts/test-admin-approvals-audit-migration.mjs
npm run test:migrations
```

Expected: exit `0`, including migration assertions for one job per command, lease reclamation, immutable audit history, and browser-deny-by-default access inherited from the Admin security model.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910125000_admin_approvals_audit.sql scripts/test-admin-approvals-audit-migration.mjs package.json
git commit -m "feat(admin): add approvals, durable execution, and immutable audit schema"
```

### Task 2: Implement shared approval policy, durable executor, and audit services

**Files:**
- Create: `packages/admin-contracts/src/approvals.ts`
- Create: `packages/admin-contracts/src/audit.ts`
- Modify: `packages/admin-contracts/src/index.ts`
- Create: `apps/admin/server/approvals/approvalService.ts`
- Create: `apps/admin/server/approvals/approvalExecutionService.ts`
- Create: `apps/admin/server/audit/auditService.ts`
- Test: `apps/admin/server/approvals/approvalService.test.ts`
- Test: `apps/admin/server/approvals/approvalExecutionService.test.ts`

**Interfaces:**
- Produces: `evaluateApprovalRequirement`, `requestApproval`, `approveRequest`, `rejectRequest`, `claimApprovedCommand`, `executeClaimedCommand`, `recoverExpiredApprovalExecution`, `appendAuditEvent`.

- [ ] **Step 1: Write failing one-time and crash-recovery tests**

```ts
it('does not execute an approved request twice', async () => {
  await service.approve({ requestId: 'r1', pin: '482731' }, owner);
  await service.approve({ requestId: 'r1', pin: '482731' }, owner);
  expect(store.createExecutionJob).toHaveBeenCalledTimes(1);
});

it('reclaims an expired execution lease after a crash before command execution', async () => {
  const first = await executor.claim('r1');
  await clock.advancePast(first.leaseExpiresAt);
  const second = await executor.claim('r1');
  expect(second.commandId).toBe(first.commandId);
  await executor.execute(second);
  expect(commandBus.businessEffectsFor(first.commandId)).toBe(1);
});

it('recovers when the command committed but completion recording timed out', async () => {
  commandBus.failCompletionWriteOnceAfterBusinessCommit();
  await expect(executor.run('r1')).rejects.toThrow();
  await executor.run('r1');
  expect(commandBus.businessEffectsFor('cmd-r1')).toBe(1);
  expect(await store.status('r1')).toBe('EXECUTED');
});
```

The fixture command bus must enforce idempotency by `command_id`; the third test is invalid if it merely mocks a second successful side effect.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/approvals/approvalService.test.ts apps/admin/server/approvals/approvalExecutionService.test.ts
```

Expected: fail before service implementation.

- [ ] **Step 3: Implement policy evaluation, durable execution, and audit append**

```ts
export type ApprovalDecision =
  | { required: false }
  | { required: true; ruleId: string; approverPermission: string };
```

Policy evaluation receives action type, actor, shop, amount/value impact, and configured threshold. `approveRequest` re-verifies approver PIN, checks `approvals.review` plus action-specific approval permission, and atomically records the decision plus durable execution job for commands that cannot finish inside the decision transaction. It must **not** rely on a database row lock remaining valid while an independent TypeScript command executes.

`approvalExecutionService` claims work through the database lease RPC, dispatches the stored command with the persisted `command_id`, and completes through the database completion RPC. If execution returns an existing idempotent result after an ambiguous prior commit, completion records that result and closes the approval without applying the business effect again. Expired claims are recoverable; active claims are not duplicated. Audit records distinguish requested, approved/rejected, execution retry/failure where relevant, and final business execution without exposing PIN or secret material.

- [ ] **Step 4: Verify service tests/typecheck**

```bash
npx vitest run apps/admin/server/approvals/approvalService.test.ts apps/admin/server/approvals/approvalExecutionService.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`, including crash-before-command, crash-after-command-before-completion, duplicate approve, expired-lease reclamation, and terminal-failure cases.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/approvals.ts packages/admin-contracts/src/audit.ts packages/admin-contracts/src/index.ts apps/admin/server/approvals apps/admin/server/audit
git commit -m "feat(admin): add recoverable approval and audit services"
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
- Produces pending approval list, one-tap Approve/Reject then PIN confirmation, recoverable execution status, and human-readable audit history.

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

Approval details show requester, shop, action, amount/value, reason, consequences, and execution state before/after decision. An APPROVED/EXECUTING item must not offer a second Approve action; safe retry/recovery is a server concern. A terminal FAILED execution shows a human-readable failure and authorized recovery path where the command policy permits a new request. Audit details render structured before/after values in human terms; raw JSON is never the default presentation. Filters include date, shop, actor, action, entity, and approval status.

- [ ] **Step 4: Verify E2E**

```bash
npx vitest run apps/admin/src/approvals/ApprovalDetailPage.test.tsx
npx playwright test e2e/admin-approvals-audit.spec.ts
```

Expected: exit `0`, including refresh/reload while an approved command is in recoverable execution state.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/api/admin/approvals.ts apps/admin/api/admin/audit.ts apps/admin/src/approvals apps/admin/src/audit e2e/admin-approvals-audit.spec.ts
git commit -m "feat(admin): add approval and audit management UI"
```
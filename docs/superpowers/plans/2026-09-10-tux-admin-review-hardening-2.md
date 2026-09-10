# TUX Admin Review Hardening Addendum 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Every amendment below is mandatory at its insertion point and follows RED → GREEN TDD.

**Goal:** Close four additional implementation-risk findings discovered during exact-head Codex review without adding product scope: guaranteed execution of durable approval jobs, synchronization of Admin-origin inventory changes back into local-first Operations, salary-expense recognition for staff payments, and canonical supplier-payment persistence.

**Authority:** This file is a reviewed execution amendment. It is mandatory together with `2026-09-10-tux-admin-review-hardening.md`. Where an older numbered plan or earlier hardening instruction omits or conflicts with these requirements, this file supplies the required execution detail while the approved design specification remains authoritative.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Durable work is not considered recoverable merely because a READY/RETRYABLE row exists; a production runner must be guaranteed to revisit it.
- Canonical inventory remains one ledger. Admin-origin and Operations-origin stock changes must converge into each Operations device's local projection without duplicating movements.
- Staff payment, cash/bank movement, and wage/salary expense reporting must reconcile without double counting.
- Supplier balances/payment status are derived from immutable purchasing/payment/return events, never manually edited summary numbers.

---

## Amendment 6: Add a production runner for durable approval execution jobs

**Insertion point:** Execute with `2026-09-10-tux-admin-approvals-audit.md` Tasks 1–3 and before Approval/Audit Gate 3 can pass.

**Files:**
- Modify planned: `supabase/migrations/20260910125000_admin_approvals_audit.sql`
- Create planned: `apps/admin/server/approvals/approvalExecutionRunner.ts`
- Create planned: `apps/admin/server/approvals/approvalExecutionRunner.test.ts`
- Create planned: `apps/admin/api/cron/admin-approval-executor.ts`
- Modify planned: `apps/admin/vercel.json`
- Modify planned: `scripts/test-admin-deployment-contract.mjs`
- Modify planned: `e2e/admin-approvals-audit.spec.ts`

**Required contract:**

1. A scheduled production runner invokes the durable executor independently of the request that approved the command. The Admin deployment contract must include the cron/queue trigger; a manual call in a unit test is insufficient.
2. The runner claims a bounded batch of `READY`, due `RETRYABLE`, and expired-lease `CLAIMED` jobs through `claim_admin_approval_execution_v1`, executes each only through the persisted `command_id` idempotency boundary, and records completion/failure through the existing completion RPC.
3. Runner invocation is server-authenticated. Browser roles cannot invoke the internal executor with arbitrary command payloads, and the route never accepts a caller-supplied command body.
4. Concurrent runner invocations are safe: the lease/claim contract means only one live claim can execute a given job. A crashed runner becomes reclaimable after lease expiry.
5. Retry uses bounded exponential/backoff metadata and a terminal failure classification. Business validation failures do not loop forever; retryable infrastructure failures remain recoverable.
6. The production scheduling cadence must be explicitly configured and verified by the deployment-contract test. The acceptance test must prove a READY job is executed even when the original approval request process terminates immediately after commit.

**RED tests:**

```ts
it('drains a READY approval job without the approving request process', async () => {
  await store.insertReadyJob('r1');
  await runner.runOnce();
  expect(await store.status('r1')).toBe('EXECUTED');
  expect(commandBus.businessEffectsFor('cmd-r1')).toBe(1);
});

it('reclaims an expired lease on a later scheduled run', async () => {
  await store.seedExpiredClaim('r1');
  await runner.runOnce();
  expect(await store.status('r1')).toBe('EXECUTED');
});
```

**GREEN acceptance:** crash-after-approval-before-dispatch, crash-with-live-then-expired-lease, concurrent runner, idempotent replay, and terminal failure cases all converge without operator guessing or duplicate business effects. The Admin deployment-contract test confirms the runner trigger exists.

---

## Amendment 7: Synchronize canonical Admin inventory changes into Operations local stock

**Insertion point:** Execute with `2026-09-10-tux-admin-inventory-purchasing.md` Tasks 1–5 before Inventory/Purchasing Gate 4 can pass.

**Files:**
- Modify planned: `supabase/migrations/20260910130000_admin_inventory_ledger.sql`
- Modify planned: `apps/admin/server/inventory/inventoryService.ts`
- Modify planned: `apps/admin/server/purchasing/purchasingService.ts`
- Create existing-side: `packages/sync/src/inventoryPull.ts`
- Create existing-side: `packages/sync/src/inventoryPull.test.ts`
- Modify existing: `packages/sync/src/httpTransport.ts` or add a dedicated authenticated pull transport
- Modify existing: `packages/sync/src/outboxSync.ts`
- Modify existing: `packages/persistence/src/*` to persist the per-shop/device inventory feed cursor and idempotent remote movement application
- Create existing-side: `packages/application/src/inventoryRemoteSync.ts`
- Create existing-side: `packages/application/src/inventoryRemoteSync.sqlite.test.ts`
- Modify existing: `packages/application/src/orders.ts`
- Modify existing: `packages/application/src/orders.test.ts`
- Modify Operations startup/scheduler wiring that currently runs configuration/outbox synchronization
- Modify planned E2E: `e2e/admin-inventory.spec.ts`

**Required contract:**

1. Every canonical inventory movement, regardless of origin (`OPERATIONS`, Admin adjustment, stocktake, waste, transfer, receiving, purchase return), is observable through a shop-scoped monotonic remote inventory feed. Use an append-only feed sequence or equivalent cursor that does not rewrite the existing authoritative `inventory_movements` history.
2. Operations periodically pulls movements after its durable per-shop cursor and applies each movement to local SQLite idempotently by canonical movement id. Pulling a movement originally emitted by that same device is a no-op if it already exists locally.
3. Admin commands commit the canonical ledger movement and its feed visibility atomically. A remote movement can never exist without becoming discoverable by the Operations pull contract.
4. On startup/reconnect and before network-available inventory-sensitive order reservation, Operations catches up the inventory feed before treating local Available stock as current.
5. Operations outbox delivery of reservation/consumption-affecting events carries the inventory base cursor/version required by the server conflict fence. If canonical inventory advanced incompatibly, the server returns a convergence conflict instead of silently accepting a stale availability assumption; Operations pulls the missing feed, reconciles, and re-evaluates the pending action.
6. Offline behavior remains explicit. An offline device may continue only under the existing reviewed Operations offline policy; on reconnect, any canonical conflict becomes a visible reconciliation state and cannot manufacture/overwrite Admin movements or silently drive canonical Available negative.
7. Transfers expose both source and destination movements through each relevant shop feed; purchase receiving and returns use the same mechanism.

**RED tests:**

```ts
it('applies an Admin adjustment to the local Operations stock projection exactly once', async () => {
  await admin.adjustStock({ itemId: 'i1', quantityDeltaBase: -500, commandId: 'a1' }, owner);
  await inventoryPull.catchUp('shop-1');
  await inventoryPull.catchUp('shop-1');
  expect(local.movementsByCanonicalId('a1')).toHaveLength(1);
  expect(local.available('i1')).toBe(remote.available('i1'));
});

it('fences a stale local reservation until missing Admin movements are reconciled', async () => {
  await admin.adjustStock(adminReduction, owner);
  const stale = await operations.trySyncReservation(reservationBuiltBeforeReduction);
  expect(stale).toMatchObject({ decision: 'INVENTORY_CONFLICT' });
  await inventoryPull.catchUp('shop-1');
  expect(() => operations.reserveAgain()).toThrow(/insufficient stock/i);
});
```

**GREEN acceptance:** Admin adjustment, stocktake, waste, transfer, receiving, and purchase return all converge to local Operations stock; duplicate pulls are harmless; stale local inventory assumptions are fenced/reconciled; existing Operations-origin movement sync remains green.

---

## Amendment 8: Make staff payments contribute exactly once to salary expense reporting

**Insertion point:** Execute with the Workforce finance prerequisite and `2026-09-10-tux-admin-workforce.md` Tasks 1–2; verify again in Finance/Reports Gate 7.

**Supersedes:** Any staff-payment instruction that inserts only `staff_payment_records` plus a `STAFF_PAYMENT` finance movement without an expense/reporting fact or an explicitly tested derivation.

**Files:**
- Modify planned: `supabase/migrations/20260910195000_admin_finance_core.sql`
- Modify planned: `supabase/migrations/20260910200000_admin_workforce.sql`
- Modify planned: `scripts/test-admin-finance-core-migration.mjs`
- Modify planned: `scripts/test-admin-workforce-migration.mjs`
- Modify planned: `apps/admin/server/staff/staffService.ts`
- Modify planned: `apps/admin/server/staff/staffService.test.ts`
- Modify planned: `apps/admin/server/finance/profit.ts`
- Modify planned: `apps/admin/server/finance/profit.test.ts`
- Modify planned: `apps/admin/server/reports/reportService.ts`
- Modify planned report tests.

**Required contract:**

- Use one canonical salary-expense fact per staff payment. The preferred implementation is an immutable `staff_payment_expense_events`/equivalent reporting event keyed one-to-one by `staff_payment_record_id` and the same `command_id`; alternatively Finance may derive salary expense directly from `STAFF_PAYMENT` movements if that derivation is explicit, immutable, and proven not to double count with general expenses.
- `record_staff_payment_v1` atomically validates the finance account and inserts: (a) the staff payment record, (b) exactly one `STAFF_PAYMENT` finance movement, and (c) exactly one salary expense/reporting fact or derivation key. A duplicate command returns the prior result with no duplicate movement/expense.
- Estimated operating profit and expense reports include paid staff salary/wage expense according to the approved management-reporting rule. Wage estimates that have not been paid are not silently treated as cash expense unless the approved reporting view explicitly labels an accrual estimate separately.
- Refund/reversal/correction is a compensating event; posted payment/expense history is never edited away.

**RED test:**

```ts
it('posts one staff payment, one money movement, and one salary expense fact', async () => {
  await service.recordPayment(command, payrollManager);
  await service.recordPayment(command, payrollManager);
  expect(store.staffPaymentCount(command.commandId)).toBe(1);
  expect(store.financeMovementCount(command.commandId, 'STAFF_PAYMENT')).toBe(1);
  expect(store.salaryExpenseCount(command.commandId)).toBe(1);
  expect(await reports.salaryExpenseForPeriod(command.payPeriod)).toBe(command.amountMinor);
});
```

**GREEN acceptance:** account history, salary expense report, and profit calculation reconcile to the same immutable payment once; no duplicate or missing expense is possible across retries.

---

## Amendment 9: Add canonical supplier-payment events and finance-account posting

**Insertion point:** Execute no later than Approved-Scope Completion Task 4, after the shared Finance core exists and before PO payment status/supplier balance UI is accepted.

**Supersedes:** Any task that derives `UNPAID | PARTIALLY_PAID | PAID` or supplier balance without a canonical recorded-payment command/event.

**Files:**
- Modify planned: `supabase/migrations/20260910210000_admin_finance.sql` or create the next forward-only purchasing/finance migration at the approved insertion point
- Modify planned: `packages/admin-contracts/src/purchasing.ts`
- Modify planned: `apps/admin/server/purchasing/purchasingService.ts`
- Modify planned: `apps/admin/api/admin/purchasing.ts`
- Modify planned: `apps/admin/server/finance/financeService.ts`
- Modify planned: `apps/admin/src/purchasing/PurchaseOrderPage.tsx`
- Modify planned: `apps/admin/src/purchasing/SupplierBalancePanel.tsx`
- Modify planned E2E: `e2e/admin-purchasing-finance-completion.spec.ts`
- Add migration/service reconciliation tests.

**Required schema/commands:**

- Immutable `supplier_payments` with `id`, `business_id`, `supplier_id`, `finance_account_id`, `amount_minor`, `paid_at`, optional reference/note, actor, `command_id`, timestamps, and unique `(business_id, command_id)`.
- Immutable `supplier_payment_allocations` linking a payment to one or more purchase orders with allocated amount. Sum of allocations cannot exceed payment amount; allocation cannot exceed a PO's current payable balance unless an explicit supplier-credit rule is represented.
- Trusted `record_supplier_payment_v1` validates supplier/business/shop scope, active finance account, positive amount, PO allocation ownership, and command idempotency; it inserts the supplier payment/allocation rows plus exactly one matching `SUPPLIER_PAYMENT` finance movement in one transaction.
- Purchase returns reduce the supplier payable through their immutable return events. A supplier balance is derived from received/invoiced purchase obligations minus purchase returns minus supplier payments plus approved adjustments/credits; it is never a user-editable balance field.
- PO payment status is derived from allocated canonical payments/returns: zero paid = `UNPAID`, positive below payable = `PARTIALLY_PAID`, fully covered = `PAID`. Reversals are compensating supplier-payment/finance events.

**RED tests:**

```ts
it('records supplier payment and finance movement exactly once', async () => {
  await service.recordSupplierPayment(command, buyer);
  await service.recordSupplierPayment(command, buyer);
  expect(store.supplierPaymentCount(command.commandId)).toBe(1);
  expect(store.financeMovementCount(command.commandId, 'SUPPLIER_PAYMENT')).toBe(1);
});

it('derives PO payment status from payments and purchase returns', async () => {
  await receive(po, 100_000);
  await service.recordSupplierPayment({ ...command, amountMinor: 40_000, allocations: [{ poId: po.id, amountMinor: 40_000 }] }, buyer);
  expect(await service.poPaymentStatus(po.id)).toBe('PARTIALLY_PAID');
  await postPurchaseReturn(po, 60_000);
  expect(await service.poPaymentStatus(po.id)).toBe('PAID');
});
```

**GREEN acceptance:** supplier balance, PO payment status, purchasing history, and finance-account history reconcile from the same immutable events; cross-business/shop allocations are rejected; retries cannot double-pay.

---

## Review Gate Added by This Addendum

Before the affected checkpoints merge:

1. Approval jobs must be shown to execute from the production runner after the approving process disappears.
2. Admin-origin stock mutations must be shown converging to Operations local SQLite with a persisted cursor and stale-inventory fence.
3. Staff payment totals must reconcile simultaneously to staff-payment records, finance movements, salary expense reporting, and profit without double counting.
4. Supplier payment status/balance must reconcile to canonical supplier-payment allocations, returns, and finance movements.
5. Exact-head CI and Codex review must pass with no unresolved serious findings.

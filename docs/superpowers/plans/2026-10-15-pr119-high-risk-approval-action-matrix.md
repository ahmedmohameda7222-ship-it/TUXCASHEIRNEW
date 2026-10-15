# PR #119 — Approved High-Risk Action Coverage Matrix

Checked against approved Admin specification §21.2 and the existing Plans 1–7 code paths on 2026-10-15. **This is a source-evidence matrix, not authorization to expose new UI actions or a completed acceptance certificate.** Keep the PR Draft until functional and integration gates pass.

## Executable configurable actions already registered

The production runner is `apps/admin/server/approvals/approvalExecutionRunner.ts`; its dependency registry delegates to order, inventory and staff action-specific runners. `approvalRuleActions.ts` lists only entries with this executable connection, and `approvalRulesRoute.ts` rejects unsupported actions and threshold/permission mismatches.

| Action | Requester permission | Trusted source / canonical execution | Threshold | Runner / durable effect | Assessment |
| --- | --- | --- | --- | --- | --- |
| `ORDER_REFUND` | `orders.refund` | `apps/admin/api/admin/orders.ts`; `request_admin_order_refund_v1` / `execute_approved_admin_order_refund_v1` | `minimumMinor` | Order runner; persisted refund receipt / transaction | Implemented; final authenticated distinct-approver acceptance outstanding |
| `ORDER_RETURN` | `orders.refund` | `orders.ts`; `return_admin_order_items_v1` / `execute_approved_admin_order_return_v1` | `minimumQuantityImpact` | Order runner; once-only return accounting | Implemented; final cross-app acceptance outstanding |
| `INVENTORY_ADJUST` | `inventory.adjust` | `apps/admin/api/admin/inventory.ts`; `post_inventory_adjustment_v1` / `execute_approved_admin_inventory_adjustment_v1` | `minimumQuantityImpact` from trusted inventory fence, not UI-provided threshold | Inventory runner; original command, revision/movement CAS, protected stock ledger | Implemented and isolated SQL-tested; final integration outstanding |
| `STAFF_PAYMENT` | `staff.payments` | `apps/admin/server/staff/staffApproval.ts`; `record_staff_payment_v1` | `minimumMinor` | Staff runner; payment command receipt | Implemented; final integration outstanding |
| `EMPLOYEE_PIN_CHANGE` | `staff.manage` | `staffApproval.ts`; `apply_employee_pin_change_v1` | None | Staff runner; secret-safe staged credential workflow | Implemented; final Operations authentication outstanding |
| `EMPLOYEE_ROLE_CHANGE` | `staff.manage` | `staffApproval.ts`; `set_employee_role_v1` | None | Staff runner with role/target checks | Implemented; final integration outstanding |
| `EMPLOYEE_PERMISSION_CHANGE` | `staff.manage` | `staffApproval.ts`; `set_employee_permission_v1` | None | Staff runner with permission/target checks | Implemented; final integration outstanding |
| `EMPLOYEE_SUSPEND` | `staff.manage` | `staffApproval.ts`; `suspend_employee_v1` | None | Staff runner with state checks | Implemented; final integration outstanding |

The existing approval service must still enforce governing shop-specific rule before business fallback, permission validation, second-person checks when enabled, approver PIN, request fingerprint and durable command replay; prior round regressions cover those invariants. The complete API+SQL integration of every row has **not** been re-certified at this checkpoint.

## Confirmed direct command paths not registered for optional approval

A role/permission check or recent reauthentication is **not** a configurable second-person approval. These paths must not be added to Approval Rules until their approved in-scope threshold semantics, trusted context, version fencing and crash-safe execution runner have been implemented and tested.

| Approved §21.2 risk | Existing BFF/service and canonical command | Current controls observed | Optional approval status | Required design work / decision |
| --- | --- | --- | --- | --- |
| Large finance/cash correction | `apps/admin/server/finance/financeOperationsApi.ts`, `finance.snapshot.adjust`, `finance_adjust_snapshot_v1` | `finance.adjust`, recent session reauth, `commandId` | **Missing configurable approval** | Trusted absolute cash impact in minor units; version/ledger revalidation; approval-bound durable finance runner |
| Large owner cash withdrawal | `financeOperationsApi.ts`, `finance.owner-withdrawal`, `execute_finance_management_v1` | `finance.adjust`, recent reauth, `commandId` | **Missing configurable approval** | Define whether threshold is transaction amount and exact supported Plan 7 action; prevent duplicate postings |
| Cashier reconciliation / cash difference | `financeOperationsApi.ts`, `finance.cashier.reconcile`, `finance_reconcile_cashier_v1` | `finance.reconcile`, `commandId` | **Not registered** | Distinguish ordinary reconciliation from large manual correction; compute server-trusted difference, not full takings |
| Shop suspension / archive | `apps/admin/api/admin/settings.ts`, `shop.lifecycle.update`, `apps/admin/server/settings/settingsShopManagement.ts`, `update_admin_shop_lifecycle_v1` | `shops.manage`, expected lifecycle state/revision | **Missing configurable approval** | Dedicated lifecycle runner preserving authority, latest state, tenant + shop scope and no unapproved outage |
| Sensitive payment/tax settings | `apps/admin/api/admin/settings.ts`, payment-method edits and `settings.publish` | Canonical settings permission/versioned command path | **Not registered; scope requires command audit** | Classify relevant payment/tax parameters and route; use exact settings snapshot/CAS and separate publication |
| Large price changes | `apps/admin/api/admin/catalog.ts` and draft publish; `private.publish_admin_catalog_draft_authorized_v1` | `catalog.pricing` when published pricing changes, draft/publish CAS | **No configurable numeric price threshold** | Derive authoritative maximum price change over published products/modifiers; approval-bound publish runner; preserve target version and draft CAS |

## Inclusion / deferral rules

- Existing Plan 4 inventory waste/stocktakes/transfers and Plan 7 accounting commands have direct permission and domain-RPC controls. Do not assume they all require a new optional approval action merely because they can affect balances; judge each against the approved risk taxonomy and actual plan authority.
- Owner permission and recent reauthentication are legitimate existing gates but cannot be described as second-person approval.
- Only action types with supported execution runners, trusted context, governing-rule behavior, replay receipts, audit, cross-tenant denial, rejection, stale version and once-only mutation tests may enter the Approval Rules selectable list.
- No Plan 8 or 9 extensions, devices, WhatsApp, dashboard/custom CRM changes, or unsupported export work belongs in this matrix.

## Coverage verification still required

For each confirmed missing in-scope action, demonstrate below/equal/above threshold, absent/malformed context, shop override/business fallback, requester and approver authorization, second-person + PIN, wrong-shop/business denial, approval/rejection, stale revision, crash/retry and once-only protected side effects. Verify the protected domain command is not executed before authorization. Classify unit/contract/isolated PostgreSQL/mocked E2E/authenticated full-stack separately.

**Current ruling: `CORRECTIONS STILL REQUIRED`.** No unsupported new action was inserted; no migration or financial/operational record was modified by this coverage audit.

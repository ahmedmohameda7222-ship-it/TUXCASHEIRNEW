# PR #119 — Approved Plans 1–7 High-Risk Approval Execution Coverage

**Evidence checkpoint:** 2026-10-15, branch `fix/admin-plans1-7-functional-completeness`, recovered HEAD `2972788c61769015e034ae3a6dc629f7622c7a87`. This matrix is an implementation inventory, **not** approval that unfinished actions are safe to enable. Verify current branch before acting on it.

The spec's §21.2 optional approvals may only be configurable when a command has trusted runtime rule enforcement, exact command serialization, a durable approval execution runner, and replay-safe canonical effects. A `shops.manage`, `settings.manage` or `finance.adjust` permission gate by itself is **not** a configurable approval.

| Approved high-risk command | Requester authorization | API / canonical command | Rule and threshold | Execution / idempotency | Current evidence and classification |
|---|---|---|---|---|---|
| Order refund | `orders.refund` | Orders API; `execute_approved_admin_order_refund_v1` | `ORDER_REFUND`, `minimumMinor`, trusted refundable amount | Canonical order approval runner; command receipts, terminal states, distinct approver PIN | **CONFIGURABLE — RUNNER CONNECTED**; contract/isolated Postgres tests |
| Order return | `orders.refund` | Orders API; `execute_approved_admin_order_return_v1` | `ORDER_RETURN`, `minimumQuantityImpact`, trusted line quantities | Same runner, guarded refunds/returns, durable receipts | **CONFIGURABLE — RUNNER CONNECTED** |
| Employee PIN change | `staff.manage` | Workforce command; staff approval runner | `EMPLOYEE_PIN_CHANGE`, no threshold | Trusted verifier, second-person decision, secret-safe persistence and replay | **CONFIGURABLE — RUNNER CONNECTED** |
| Employee role change | `staff.manage` | Workforce command; staff approval runner | `EMPLOYEE_ROLE_CHANGE`, no threshold | Role hierarchy and authorization revalidated by canonical worker, idempotent receipt | **CONFIGURABLE — RUNNER CONNECTED** |
| Employee permission change | `staff.manage` | Workforce command; staff approval runner | `EMPLOYEE_PERMISSION_CHANGE`, no threshold | Canonical permission mutator and durable worker | **CONFIGURABLE — RUNNER CONNECTED** |
| Employee suspension | `staff.manage` | Workforce command; staff approval runner | `EMPLOYEE_SUSPEND`, no threshold | Canonical workforce active-state mutation and audit | **CONFIGURABLE — RUNNER CONNECTED** |
| Inventory quantity adjustment | `inventory.adjust` | Inventory API; `execute_approved_admin_inventory_adjustment_v1` | `INVENTORY_ADJUST`, `minimumQuantityImpact`, derived from signed **microunits** | Existing approval runner, expected item definition version/movement count, idempotent inventory command | **CONFIGURABLE — RUNNER CONNECTED** |
| Staff payment | `staff.payments` | Workforce payment; staff approval runner | `STAFF_PAYMENT`, `minimumMinor`, trusted amount | Durable worker, exact payment command identity and audit | **CONFIGURABLE — RUNNER CONNECTED** |
| Shop suspension / reactivation | `shops.manage` | `shop.lifecycle.update` → `update_admin_shop_lifecycle_v1` | **No** registered `SHOP_LIFECYCLE` rule or trusted approval threshold | Direct canonical RPC has expected lifecycle revision + state, but **no verified approved replay runner** | **INCOMPLETE (Plans 2/3)**. Do not expose until protected effect and receipt support exist |
| Shop archive | `shops.manage` | `shop.delete-or-archive` → Settings service deletion/archive command | **No** executable rule | Direct protected shop management; missing approved durable runner and stale version/replay contract | **INCOMPLETE (Plans 2/3)**; destructive/cutover semantics require Planner decision if incompatible |
| Financial snapshot/cash correction | `finance.adjust`; recent reauth on snapshot adjustment | `finance.snapshot.adjust` → `finance_adjust_snapshot_v1`; cashier reconciliation uses `finance.reconcile` | **No** configured threshold rule. Existing signed adjustment input has no expected snapshot revision in BFF contract | Direct finance RPC with original command ID; no approved runner. A new rule cannot be shown until stale/once-only effects are verified | **INCOMPLETE (Plans 3/7)** |
| Owner withdrawal and other high-value transfers | `finance.adjust`; recent reauth for withdrawal | Finance operations API → `execute_finance_management_v1` | **No** configurable amount threshold | Direct account management RPC, command ID, ledger audit; no approval execution adapter | **INCOMPLETE (Plans 3/7)** |
| Sensitive payment method/channel changes | `settings.manage` | `payment-method.create/update` → Settings service trusted row RPCs | **No** payment-policy approval action | Direct controlled row mutation / settings publication; no approval runner or durable approval command receipts | **INCOMPLETE (Plans 2/3)** |
| Tax and service charge configuration | `settings.manage` | `setting.default.upsert/override.upsert` on `checkout.taxBps`, `checkout.serviceChargeBps`; separate settings publish | **No** trusted `SETTINGS_TAX_CHANGE` approval | Direct setting-layer CAS and separate publication; no durable approved command runner | **INCOMPLETE (Plans 2/3)** |
| Large catalog price changes | `catalog.pricing` + publish permission | `draft.save`, trusted `apply_catalog_draft_change_v1`, separate `publish_catalog_draft_v1` | **No** `CATALOG_PRICE_CHANGE` value-delta threshold rule | Canonical draft CAS, pricing check and publication; no approved command runner and no trusted threshold computed from live/snapshot differences | **INCOMPLETE (Plans 2/3)** |
| Negative stock override | `inventory.override_negative` | Inventory adjustment command with `emergencyNegativeOverride` | Governed by already-registered `INVENTORY_ADJUST` approval where enabled | Preserve existing trusted override flag and inventory approval runner; do not create a duplicate action unless spec requires independent rule | **COVERED BY EXISTING ACTION** |
| Unrelated WhatsApp/devices/alerts/manager-log | Depends on later Plan 8 implementation | Outside Plans 1–7 | No in-scope rule | No eligible executable runner yet | **DEFERRED — Plan 8** |

## Source-of-truth proof

- Configurable UI whitelist: `apps/admin/server/approvals/approvalRuleActions.ts` (exactly eight actions); `approvalRulesRoute.ts` rejects unknown action types and mismatched requester permission/threshold kinds.
- Executable runner: `apps/admin/server/approvals/approvalExecutionRunner.ts`, `approvalExecutionService.ts`, and the order, inventory and workforce-specific registries. Lease/retry recovery is not proof of exactly-once effects unless the protected SQL command is idempotent.
- Shop lifecycle: `apps/admin/api/admin/settings.ts`, `apps/admin/server/settings/settingsShopManagement.ts`; `update_admin_shop_lifecycle_v1` has an expected revision, but not a registered approval runner.
- Finance: `apps/admin/server/finance/financeOperationsApi.ts`, `financeApi.ts`. Permissions and recent reauthentication are additional protections, not approvals.
- Catalog: `apps/admin/api/admin/catalog.ts`, `apps/admin/server/catalog/catalogService.ts`, trusted Catalog draft/publish PostgreSQL migrations.
- Existing action availability is not tested merely by the presence of SQL names; the accepted exact-head CI at the starting checkpoint was 13/13 green. Run new isolated approval tests for every new action and recheck the **new final HEAD**.

## Required implementation gates per confirmed missing action

1. Determine protected effect and exact governing shop/business rule, including shop-specific precedence over business-wide fallback.
2. Derive amount/quantity/price delta **server-side** (not a client-supplied approval threshold), with below/equal/above threshold tests; reject malformed or missing trusted context.
3. Authorize requester before opening approval; require distinct approver, current PIN/permissions and shop membership at decision/execution.
4. Use exact serialized payload and stable command ID, durable runner, canonical SQL mutator with expected versions, once-only receipts, auditable failure and retry.
5. Verify no mutation before approved execution and no duplicate effect after crash/retry; never add a registry action without a live executor.
6. Only then expose action in `APPROVAL_RULE_ACTIONS` and Approvals UI. Do not weaken current OWNER-only or business isolation boundaries.

**Ruling:** do not present unimplemented actions as working configurable controls. Finance snapshot adjustments and shop lifecycle are the first concrete follow-ups because existing domain commands exist; their current revision/idempotency semantics must be proved before adding a new approval wrapper. This document does not itself close those P1/P2 implementation gaps.

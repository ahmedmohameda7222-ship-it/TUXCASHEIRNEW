# TUX V2 Data Model

## Principles

The V2 model separates mutable configuration from immutable operational history.

Configuration can evolve over time. Placed orders, payments, stock movements, reconciliation facts, audit events, and closed Business Days must remain historically truthful.

All shop-owned records carry an explicit `shopId` / `shop_id`. Records that belong to a shift carry an immutable `businessDayId` / `business_day_id` rather than deriving shift identity from a calendar date.

## Exact numeric models

### Money

Money uses integer minor units through `MoneyMinor`.

```text
E£100.00 => integer minor-unit representation
```

Formatting is presentation only. Business arithmetic never depends on binary floating point.

Editable Orders money fields are parsed from decimal strings directly into minor units. Inputs with more than two decimal places, malformed values, negative values where not allowed, or values outside the safe-integer range are rejected instead of being coerced through floating-point arithmetic.

#Phase 6 projects manual Expenses through `ExpenseLedgerRecord`. Manual rows carry operational lifecycle metadata (`revision`, last edit attribution/time, soft-delete attribution/time). Legacy manual rows without lifecycle metadata are upgraded in memory to revision zero. Editing preserves immutable identity and original creation time. Delete is a soft-delete: it removes the row from the current operational ledger/totals while preserving the durable database fact and audit history.

`calculateExpenseTotals()` returns two exact projections: `totalExpensesMinor` includes every active manual Cash/Other expense, while `cashExpensesMinor` includes only active manual Cash expenses for later Expected Cash calculation. `DELIVERY_FAILED` and soft-deleted manual rows contribute to neither projection. System Delivery Failed rows remain locked from manual edit/delete.

## Inventory quantities

Inventory uses fixed-point integer micro-units through `StockQuantityMicros`.

```text
1 whole stock unit = 1,000,000 micros
```

This supports both whole Bulk Stock events and fractional recipe consumption without floating-point drift.

## Identity

Operational entities use branded UUID identifiers in TypeScript and UUID/text primary keys in durable stores.

Display order numbers are not database identity. Orders use:

```text
id                 immutable global UUID
businessDayId      immutable parent Business Day
displayOrderNo     human-facing number scoped to Business Day
idempotencyKey     retry/duplicate protection
```

The remote and SQLite schemas protect `(shop, business day, display order number)` and shop-scoped idempotency keys with uniqueness constraints.

## Business Day

Business Day is a discriminated union:

```text
OPEN
  endedAt = null
  endedByWorkerId = null

CLOSED
  endedAt = Instant
  endedByWorkerId = WorkerId
```

Only one Business Day may be OPEN for a shop. Midnight is not part of the identity model.

The order-number allocator belongs to the Business Day and advances `lastAllocatedDisplayOrderNo` transactionally.

## Worker and remote authorization identity

Worker identity and remote authorization are distinct.

Worker:

- identifies the person operating the POS;
- carries a secure PIN hash field;
- never stores a plaintext production PIN in normal durable records.

Remote authorization:

- will later use authenticated Supabase/app/device context;
- is prepared through shop memberships and RLS-ready tables;
- is not implemented by trusting a worker PIN from the browser.

## Configuration

Remote Postgres stores normalized configuration entities:

- menu categories;
- products;
- modifiers;
- product/modifier relationships;
- combo beverage options;
- recipe lines;
- order types;
- payment methods;
- delivery zones;
- inventory items;
- workers/devices.

The local Operations database stores a versioned `OperationsConfigurationSnapshot` as one atomic aggregate per shop. This is deliberate: a device should boot from one coherent catalog/configuration version rather than a partially updated mix of menu versions.

Later Admin synchronization can replace the local snapshot transactionally without changing React or business-rule code.

## Durable Order draft

The editable pre-checkout state is `OrderDraft`, separate from immutable placed Orders.

A draft carries:

```text
shopId
businessDayId
draftScopeId
revision
updatedAt
checkoutIntentKey
orderTypeId
lines
orderNote
discountMinor
delivery
payment
```

`draftScopeId` prevents independent live renderer contexts from silently sharing one mutable draft. Desktop currently uses one primary renderer scope; browser fallback creates a stable scope for the current browser tab/session.

`revision` supports optimistic stale-write rejection in both SQLite and IndexedDB draft stores. A caller cannot overwrite a newer persisted revision silently.

`checkoutIntentKey` is stable while the worker edits/retries the same checkout intent. It becomes the placed Order idempotency key. After successful checkout the application rotates to a new intent key for the next draft.

Draft lines snapshot the currently selected product name/price, modifiers, combo beverage choices, item note, quantity, and deterministic `addedSequence`. Direct product decrement removes from the most-recent applicable configuration deterministically. Combo products require one allowed available beverage per combo unit.

The Delivery draft stores both the configured zone fee reference and the final worker-charged fee so a legitimate manual fee edit does not erase the configuration context.

Draft persistence has no placed-order side effects. Inventory, customer learning, audit, numbering, payment history, and outbox work occur only at successful checkout.

## Orders

`OrderSnapshot` preserves the commercial facts needed for receipt/report history:

- immutable order identity;
- Business Day and display number;
- source/status;
- operator identity and display-name snapshot;
- order type behavior/label;
- Delivery customer/zone/fee snapshot where applicable;
- product names and unit prices;
- modifier labels/prices;
- included combo beverages;
- item/order notes;
- subtotal, discount, delivery fee, total;
- structured payment parts.

Placed order commercial content is not modeled as an editable configuration blob. Phase 5 adds optional `OrderLifecycleSnapshot` metadata so orders written before the lifecycle field existed remain readable. Lifecycle metadata carries an operational revision, `doneAt`, cancellation decision/worker/reason, and Delivery Failed return worker/reason.

The persistence `OrderRepository` has no general order editor. Its narrow `updateOperationalState()` starts from the durable saved snapshot and changes only status/lifecycle metadata. Items, fulfillment/customer snapshot, operator, prices, discount, Delivery fee, total, payments, Business Day/display number and idempotency identity are preserved. Corrections therefore remain explicit audited transitions rather than history rewrites.

## Payments

Payment display labels and business logic are separate.

```text
label      mutable configuration/snapshot text
logicType  CASH | CARD | DIGITAL | OTHER
```

Cash parts include allocated amount, received amount, and change. Non-cash parts cannot carry Cash Received/Change fields.

The domain integrity check requires payment allocation to equal the exact order total.

The current worker-facing Orders UI exposes the configured active non-Card methods; current real operational methods are Cash and Instapay. Split payment is represented as exactly two structured parts. Amount B is calculated as the exact remainder rather than independently entered.

## Customer contacts

Customer contacts are learned only from successfully committed Delivery Orders.

The local identity key is `(shopId, normalizedPhone)`. Egyptian phone normalization converts valid supported display forms to one canonical matching form while preserving user-facing display text separately.

A failed/invalid checkout cannot create or update a customer contact because customer learning occurs inside the same durable local order transaction.

## Expenses

Expense is a discriminated union.

Manual financial expense:

```text
kind = MANUAL
amountMinor = MoneyMinor
paidFrom = CASH | OTHER
orderId = null
```

Delivery Failed operational record:

```text
kind = DELIVERY_FAILED
amountMinor = null
paidFrom = null
orderId = original Delivery order
```

`null` is intentional and means there is no financial expense amount. It is not equivalent to zero.

A DONE Delivery marked Delivery Failed keeps its historical order total/payment snapshot for audit/receipt history, while the return audit/outbox facts explicitly state zero recognized revenue, zero collected payment, reconciliation exclusion, and no inventory restoration. The linked `DELIVERY_FAILED` Expense remains non-financial.

## Inventory

Inventory is a movement ledger, never a normal direct-overwrite model.

Tracking modes:

```text
RECIPE_TRACKED
BULK_MANUAL
```

Movement types include order consumption, cancellation restock, Bulk Stock receive/finish, compensating Undo, and future Admin adjustment.

Every movement has an immutable ID, exact signed `quantityDeltaMicros`, worker attribution, timestamp, and idempotency key. Compensating movements reference the movement they correct where applicable.

Order checkout appends exact `ORDER_CONSUMPTION` movements after validation inside the same local transaction as the historical Order. If an ACTIVE order is later cancelled before food was prepared, Phase 5 appends a positive `CANCEL_RESTOCK` for each original consumption movement and links it through `compensatesMovementId`; the original movement is never edited/deleted. If food was already prepared, no restock movement is created. Calculated shortage is not modeled as a reason to mutate or reject the draft by itself; human-controlled Sold Out configuration owns sellability blocking.

## Reconciliation

Reconciliation is attached immutably to a Business Day.

Each line snapshots:

- payment method label/type;
- expected amount;
- actual amount;
- difference;
- required reason when difference is non-zero.

Variance remains a reconciliation fact and is not implicitly converted to an Expense or Revenue event.

## Audit and outbox

Audit events record important business transitions independently of UI state.

The local outbox stores:

- aggregate/event identity;
- shop and optional Business Day;
- idempotency key;
- payload version/data;
- creation time;
- retry count and next attempt;
- last error;
- delivery time.

Business writes and their outgoing sync intent can be written in the same local transaction.

Placed Orders append `ORDER_PLACED` audit/outbox records inside the same transaction as Order/inventory/customer facts. Phase 5 Board transitions similarly append `ORDER_MARKED_DONE`, `ORDER_DONE_UNDONE`, `ORDER_CANCELLED`, or `DELIVERY_RETURNED` audit/outbox work in the same local transaction as the corresponding lifecycle, compensation, or Delivery Failed expense facts. Operational outbox idempotency keys include order lifecycle revision so retries do not ambiguously identify different corrections.

Phase 6 manual Expense create/edit/delete commits its audit and outbox intent atomically with the revision-checked expense mutation. Expense outbox identity includes immutable Expense ID, lifecycle revision, and event type so separate corrections cannot collapse into one sync identity.

## Receipt projection

Receipt output is a projection of the immutable `OrderSnapshot`, not mutable menu configuration or the current draft.

`@tux/printing` escapes order-controlled text and formats exact minor-unit amounts into receipt HTML. Reprint loads the already-saved Order by immutable `OrderId`; it cannot change order content, numbering, inventory, audit, or outbox state.

## Physical schema strategy

Local SQLite and remote Postgres intentionally do not have identical physical shapes.

SQLite is the device transaction store. It keeps essential indexed/constrained columns plus immutable aggregate JSON where that reduces duplication between local repositories and domain snapshots.

Remote Postgres is normalized for relational integrity, reporting, future Admin workflows, RLS, and cross-device synchronization.

The shared TypeScript domain contract—not physical table parity—is the semantic source of truth between adapters.

## Bulk Stock movement projection

Bulk Stock has no mutable worker-facing count field. The balance is the exact sum of append-only `InventoryMovement.quantityDeltaMicros` for a `BULK_MANUAL` item, including movements from earlier closed Business Days. Worker-originated Bulk Stock quantities are exact whole units represented with the existing stock micro-unit scale.

Worker movement types are `BULK_UNIT_FINISHED`, `BULK_STOCK_RECEIVED`, `UNDO_BULK_UNIT_FINISHED`, and `UNDO_BULK_STOCK_RECEIVED`. A compensating Undo preserves the original historical fact and links the opposite movement through `compensatesMovementId`.

`Add Stock` is an inventory-only physical receipt event. It has no price/cost/Paid From field and creates no Expense or Purchase financial record. Every committed worker movement carries immutable Business Day, worker, timestamp, command/idempotency identity, audit and outbox attribution.

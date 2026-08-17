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

### Inventory quantities

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

Placed order content is not modeled as an editable configuration blob. Later corrections use explicit state transitions/events.

## Payments

Payment display labels and business logic are separate.

```text
label      mutable configuration/snapshot text
logicType  CASH | CARD | DIGITAL | OTHER
```

Cash parts include allocated amount, received amount, and change. Non-cash parts cannot carry Cash Received/Change fields.

The domain integrity check requires payment allocation to equal the exact order total.

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

## Inventory

Inventory is a movement ledger, never a normal direct-overwrite model.

Tracking modes:

```text
RECIPE_TRACKED
BULK_MANUAL
```

Movement types include order consumption, cancellation restock, Bulk Stock receive/finish, compensating Undo, and future Admin adjustment.

Every movement has an immutable ID, exact signed `quantityDeltaMicros`, worker attribution, timestamp, and idempotency key. Compensating movements reference the movement they correct where applicable.

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

## Physical schema strategy

Local SQLite and remote Postgres intentionally do not have identical physical shapes.

SQLite is the device transaction store. It keeps essential indexed/constrained columns plus immutable aggregate JSON where that reduces duplication between local repositories and domain snapshots.

Remote Postgres is normalized for relational integrity, reporting, future Admin workflows, RLS, and cross-device synchronization.

The shared TypeScript domain contract—not physical table parity—is the semantic source of truth between adapters.

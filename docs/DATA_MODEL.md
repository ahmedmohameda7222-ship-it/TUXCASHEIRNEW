# TUX V2 Operations Data Model

## Exact value types

Accounting uses integer minor units (`MoneyMinor`) only. Inventory quantities use signed integer micro-units (`StockQuantityMicros`). Timestamps are validated ISO instants and domain entities use branded UUID-based IDs. Floating-point accounting and display formatting are never accounting truth.

## Business Day and worker sessions

A Business Day is a first-class OPEN/CLOSED aggregate independent of calendar midnight. Order display numbers are allocated inside that Business Day and restart at `#1` only for a new Business Day. Worker sessions belong to a Business Day; Operations exposes no reopen command after close.

## Configuration snapshot

`OperationsConfigurationSnapshot` is one complete versioned aggregate per shop containing categories, products, modifiers/links, combo beverage options, recipes, order types, payment methods and delivery zones. `OperationsConfigurationBundle` additionally carries inventory configuration required for an atomic local install.

Inbound bundles are runtime-validated for stable IDs, shop identity, uniqueness and referential consistency. Configuration versions are monotonic; stale remote versions cannot downgrade local state.

## Orders

A placed `OrderSnapshot` contains immutable commercial facts:

- UUID and Business-Day-scoped display number;
- configuration version at placement;
- item/product/modifier/combo snapshots;
- order type/fulfillment and Delivery customer/zone/fee snapshot;
- payment method logic snapshots and exact allocations/change;
- discount/totals;
- placement operator and created time.

Operational lifecycle is separate and revisioned. Approved transitions are ACTIVE → DONE, bounded DONE undo back to ACTIVE, ACTIVE → CANCELLED and DONE Delivery → RETURNED. Lifecycle mutations do not rewrite the immutable placement snapshot.

## Durable drafts and checkout intent

`OrderDraft` has a local draft scope, monotonic draft revision and stable `checkoutIntentKey`. Checkout idempotency is anchored to that intent. If restart finds a draft whose checkout intent already has a committed Order, startup recovery rotates to a new intent rather than showing the sold cart again or requiring another Place Order click.

## Payments and End Day

Payment behavior uses stable logic types (`CASH`, `DIGITAL`, etc.), not display-name comparisons. Current configuration includes Cash and Instapay. End Day blind-counts actual reconciliation methods before expected values are revealed.

Expected Cash uses eligible collected Cash minus active Cash-paid manual Expenses. RETURNED Delivery and CANCELLED Orders are excluded from collected-payment recognition. Non-zero variance is its own reconciliation fact and requires a reason; it is not auto-converted into revenue or an Expense.

The worker Final Closing Summary contains order status counts, payment reconciliation and Expense totals. It intentionally does not show Profit/Margin/COGS or a separate Recognized Sales tile.

## Expenses

Manual Expenses are revisioned (`lifecycle_revision`) and soft-deleted for operational history. `paidFrom` is Cash or Other. `DELIVERY_FAILED` is a locked system record with `amount = null`; it is non-financial and cannot be manually edited/deleted.

## Inventory

`InventoryMovement` is append-only and exact. Movement types cover Order consumption, cancellation restock, Bulk Stock receive/finish and compensating undo. Operations has no direct stock overwrite. Later Admin stock-adjustment capability remains future scope.

## Outbox

Every durable business fact that must synchronize later has a local outbox event with shop, Business Day, aggregate identity, event type/version, idempotency key and attempt state. Revisioned aggregate streams also carry `aggregateRevision`:

- Order placement = 0; later lifecycle revisions advance monotonically;
- Expense lifecycle revision;
- Business Day start = 0 / close = 1;
- worker session open = 0 / terminal = 1;
- independent facts such as individual inventory movements may use no aggregate revision.

Permanent failure can mark dependent later aggregate revisions as blocked by the failed origin without stopping unrelated aggregates.

## Remote materialization policy

The remote-compatible plan distinguishes placement/upsert from lifecycle/update. A lifecycle event cannot null or replace `configuration_version`, original timestamps, placement operator/fulfillment, immutable totals/items/payments or other placement-only columns.

Receiver guards prevent stale lower Order/Expense revisions, older customer-contact learning, and stale worker/Business-Day lifecycle writes from regressing current state.

## Remote database

Postgres migrations normalize the same facts for future authenticated sync/Admin/reporting while preserving tenant integrity and RLS. They are repository-tested from zero, but no remote Supabase project is connected or migrated in this phase.

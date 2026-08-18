# TUX V2 Offline and Sync Model

## Local-first rule

A business action is successful only after its local durable transaction commits.

```text
validate
→ durable local transaction
→ acknowledge success
→ synchronize later
```

Cloud availability is not part of the success definition for a valid local Operations action.

Local durable failure is different from remote sync failure and must remain a blocking failure.

## Desktop durability

Desktop Operations uses SQLite behind the native application boundary.

Current storage characteristics:

- Node/Electron main-process ownership;
- one local SQLite connection;
- `foreign_keys = ON`;
- `synchronous = FULL`;
- explicit `BEGIN IMMEDIATE` transaction boundary;
- versioned local migrations;
- no renderer access to the raw database handle.

The first implementation deliberately does not enable WAL. The primary deployment is one Operations device/process, so a simpler single-writer transaction model is preferred until real concurrency requires a different journal strategy.

## Browser fallback durability

Browser fallback uses IndexedDB through the same `OperationsDatabase` contract.

The adapter:

- opens a versioned database;
- requests persistent browser storage where supported;
- uses `readwrite` transactions with a strict durability hint;
- keeps business repositories inside one transaction boundary.

Browser storage cannot be represented as having the same operating-system durability guarantee as the desktop database. The fallback remains useful, but deployment documentation and UI diagnostics must preserve that distinction.

### IndexedDB transaction discipline

Work executed inside an IndexedDB transaction must remain within the transaction's repository requests. Application code must not await unrelated network calls, timers, dialogs, printing, or other external async work inside that callback because the browser may make the transaction inactive/commit it between requests.

Remote synchronization and receipt printing always occur after the local business transaction, never inside it.

## Durable Orders drafts

Order editing is locally durable before checkout.

A draft is identified by shop, Business Day, and an opaque runtime-local draft scope. Each saved draft has a revision and a stable checkout-intent key. Desktop persists drafts in SQLite and browser fallback persists them in IndexedDB.

Draft saves use stale-revision protection. Two live contexts must not silently overwrite each other. A restart can therefore recover the latest durable draft without creating order, payment, inventory, customer, audit, or outbox effects before checkout.

Successful checkout rotates the draft to a new checkout-intent key and clears business content according to the approved reset rules. An older committed intent cannot delete or replace a newer draft that already advanced.

## Atomic local configuration

Operations configuration is stored locally as one versioned snapshot per shop.

This prevents startup from rendering a half-old/half-new menu while background synchronization is replacing configuration. A future sync operation can validate a complete configuration version and replace it atomically.

## Durable checkout and idempotency

A valid checkout is serialized through the application coordinator and performs all business effects inside one local transaction:

```text
allocate Business-Day display number
write immutable order snapshot
write payment snapshots
append inventory movements
learn successful Delivery contact
append audit event
append outbox event
commit
```

If any local write fails, the transaction rolls back. The order number allocation, order, inventory movement, audit event, outbox event, and successful-customer learning do not partially survive. The durable draft remains available for retry.

The draft checkout-intent key becomes the order idempotency key. Retrying an already committed intent returns the saved order rather than creating a second order or repeating inventory/outbox effects. If the current draft scope has already advanced, recovery preserves that newer draft.

## Orders Board local corrections

Orders Board reads and mutates only the currently open Business Day. A Board action is serialized through the shared application coordinator and re-validates the open Business Day plus target order before committing.

`Mark Done` updates operational lifecycle metadata plus audit/outbox only. Its Undo is authoritative for at most eight seconds and creates a new lifecycle revision; after that window the service rejects reopening.

Cancellation and Delivery Failed remain local-first atomic corrections:

```text
Cancel, food not prepared
→ status/lifecycle CANCELLED
→ append compensating CANCEL_RESTOCK movement(s)
→ audit
→ outbox
→ one commit

Cancel, food prepared
→ status/lifecycle CANCELLED
→ no inventory restoration
→ audit
→ outbox
→ one commit

DONE Delivery → Delivery Failed
→ status/lifecycle RETURNED
→ no inventory restoration
→ linked DELIVERY_FAILED Expense with amount = null
→ audit/outbox zero-revenue + zero-collected-payment + reconciliation-exclusion facts
→ one commit
```

The historical order items/fulfillment/total/payment snapshot is never rewritten by these corrections. If any local write in a correction fails, the transaction rolls back as a unit. Cloud availability is not part of success.

## Expenses local ledger mutations

Manual Expense create/edit/delete is local-first. The application resolves the current open Business Day and Current Operator, then `ExpenseLedgerStore` re-validates both inside the durable mutation boundary.

```text
manual expense create/edit/soft-delete
→ revision/context check
→ write manual expense state
→ append audit event
→ append durable outbox event
→ one local commit
```

If audit/outbox persistence fails, the manual expense mutation rolls back with it. SQLite integration injects an outbox primary-key collision and proves that neither the Expense nor its audit row partially survives. `DELIVERY_FAILED` records remain read-only/non-financial. Soft-deleted manual rows remain stored but are excluded from the operational list and exact Cash/Total projections.

## Printing after local commit

Receipt printing is explicitly post-commit.

Fresh checkout attempts printing only after the durable local order transaction succeeds. Print failure therefore cannot roll back or corrupt a valid placed order. The renderer reports that the order is saved locally and offers Retry Print using the immutable saved `OrderId`.

An idempotent/recovered checkout does not automatically print again because prior print completion cannot be proven safely after a retry or crash. It reports unknown print status and offers intentional Reprint instead. Reprint reads the immutable saved order and has no order, inventory, audit, numbering, or outbox mutation side effects.

## Durable outbox

The outbox is part of the local database, not React memory.

Each outgoing event contains:

```text
id
eventType
aggregateType
aggregateId
shopId
businessDayId
idempotencyKey
payloadVersion
payload
createdAt
attemptCount
nextAttemptAt
lastError
deliveredAt
```

A critical application command writes both its business mutation and outgoing sync intent in one local transaction. If the transaction rolls back, neither survives. If it commits and the app closes immediately afterward, the outbox entry remains available after restart.

Phase 4 checkout writes `ORDER_PLACED` outbox work inside the same transaction as the order/inventory/audit mutation. Phase 5 Board transitions likewise write their audit/outbox work atomically with status/lifecycle and any cancellation-restock or Delivery Failed expense effects. Phase 6 manual Expense create/edit/delete writes the corresponding expense revision plus audit/outbox work atomically. No remote network call is needed for checkout, Board-transition, or Expense-ledger success.

## Retry semantics

The sync worker will later:

1. load pending outbox events in creation order;
2. send them using stable aggregate/event/idempotency identity;
3. mark delivered only after the remote write is confirmed;
4. record failures with attempt count, error, and backoff time;
5. resume automatically after restart/network recovery.

Worker-facing manual sync is not part of the product contract.

## Remote-disabled development state

No V2 Supabase project is configured yet.

The remote adapter therefore remains disabled/unconfigured while all local Operations/domain development continues. Pending local outbox work is a normal state, not a reason to block local business actions.

## Failure categories

Current application behavior distinguishes at minimum:

```text
validation failed
local durable save failed
saved locally but print failed
saved locally with print status unknown after idempotent recovery
remote sync pending
remote conflict
idempotent replay
```

A remote or print failure must never be reported as if the local business transaction failed after it already committed.

## Restart recovery

Automated SQLite tests verify transaction rollback and that pending outbox/configuration data survive closing and reopening the database file.

Phase 4 adds durable draft restart/idempotency design plus integration tests proving that a stale committed checkout intent cannot duplicate order/inventory/outbox effects or delete a newer draft. Later phases add workflow-level restart tests for Business Day close and sync retry.

## Bulk Stock local-first mutations

`Finished 1`, `Add Stock`, and short Undo are local-first operations and do not depend on cloud availability.

```text
resolve open Business Day + Current Operator
→ validate active BULK_MANUAL item / whole-unit input / command identity
→ append inventory movement
→ append audit event
→ append durable outbox event
→ one local commit
```

A retry with the same command UUID resolves to the already committed movement rather than creating another movement. Undo appends the exact opposite movement and the persistence boundary prevents a second compensation. If movement/audit/outbox persistence cannot commit atomically, the worker command fails locally and the movement is not acknowledged.

Balance is derived from durable movement history across Business Days. Phase 7 adds no End Day reset path; the actual End Day phase must still prove that closing a Business Day does not mutate Bulk Stock.

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

Current Phase 2 storage characteristics:

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

Work executed inside an IndexedDB transaction must remain within the transaction's repository requests. Application code must not await unrelated network calls, timers, dialogs, or other external async work inside that callback because the browser may make the transaction inactive/commit it between requests.

Remote synchronization always occurs after the local transaction, never inside it.

## Atomic local configuration

Operations configuration is stored locally as one versioned snapshot per shop.

This prevents startup from rendering a half-old/half-new menu while background synchronization is replacing configuration. A future sync operation can validate a complete configuration version and replace it atomically.

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

A critical application command should write both its business mutation and outgoing sync intent in one local transaction. If the transaction rolls back, neither survives. If it commits and the app closes immediately afterward, the outbox entry remains available after restart.

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

Later application commands must distinguish at minimum:

```text
validation failed
local durable save failed
saved locally but print failed
saved locally and cloud sync pending
remote conflict
idempotent replay
```

A remote failure must never be reported as if the local business transaction failed after it already committed.

## Restart recovery

Phase 2 automated SQLite tests verify transaction rollback and that pending outbox/configuration data survive closing and reopening the database file.

Later phases add workflow-level restart tests for drafts, orders, Business Day close, and sync retry.

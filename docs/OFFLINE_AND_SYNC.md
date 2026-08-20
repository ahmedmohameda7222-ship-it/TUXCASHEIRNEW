# Offline, Outbox and Sync

## Local-first rule

Valid worker actions are complete when the authoritative local transaction commits. Remote failure never converts a valid local Order, Board correction, Expense, Bulk Stock movement or End Day close into a local failure.

```text
validate authoritative context
→ one durable local transaction
→ audit + outbox atomically with business state
→ return local success
→ automatic synchronization later
```

There is no worker manual Sync button.

## Order checkout and printing

Printer/OS I/O is outside both the SQLite transaction and global application command lock. A committed Order remains committed if printing hangs or fails. Fresh placement attempts print once; an idempotent replay does not auto-print because prior physical print status is unknowable.

## Crash-safe draft recovery

Draft persistence and checkout intent survive restart. On Orders workspace load:

1. load the durable draft;
2. check whether its checkout intent already has a committed Order for the shop;
3. if not, continue normally;
4. if committed, rotate to a fresh intent/default order type/payment state;
5. preserve a newer draft that already advanced;
6. expose `PREVIOUS_ORDER_ALREADY_SAVED` and never auto-reprint.

This avoids duplicate Order, inventory, customer-learning, audit and outbox effects after a crash between commit and draft reset.

## Automatic outbound sync

`AutomaticOutboxScheduler` retries pending work with durable attempt/backoff state. Transient delivery failure preserves ordered retry. Permanent failure quarantines the origin.

### Causal aggregate blocking

Revisioned streams cannot skip a permanently failed predecessor. When an event is permanently quarantined, later revisions for that aggregate are marked dependent/blocked with the origin event identity. They no longer appear as independently deliverable pending work. Unrelated aggregates continue normally.

This model covers Order lifecycle, Expense revisions, Business Day start/close and worker-session lifecycle. Independent inventory/reconciliation facts remain independent unless their contract explicitly assigns a causal revision.

Restart preserves origin quarantine and dependent blocking, and the pending query cannot busy-loop over quarantined rows. See `docs/adr/0009-outbox-aggregate-dependency-and-monotonic-materialization.md`.

## Operations Sync V1 trust boundary

Network JSON enters the receiver as `unknown`. `parseOperationsSyncEnvelopeV1` reconstructs and validates the complete supported V1 envelope before `buildRemoteMaterializationPlanV1` can produce mutations.

Validation includes nested UUIDs, payload/event version/type, shop/Business-Day identity, ISO timestamps, status/payment enums, safe integer money, item/modifier/combo quantities, Delivery customer shape, lifecycle revisions, Expense lifecycle, inventory movement/reconciliation/session shape and cross-object identity invariants.

A TypeScript cast is not accepted as network validation.

## Monotonic receiver policy

Remote current state may advance but stale events may not regress it:

- **Orders:** operational revision guard; placement writes immutable snapshot, lifecycle events update only current lifecycle columns.
- **Expenses:** lifecycle revision guard.
- **Customer contacts:** older `last_order_at` learning cannot replace newer name/address/zone learning.
- **Worker sessions / Business Day:** terminal/closed state is monotonic and stale writes cannot reopen it.

The real authenticated Supabase receiver is a future phase; repository policy functions and mutation guards are already deterministic/tested so the adapter has an explicit contract to implement.

## Inbound configuration foundation

`OperationsConfigurationSyncService` is the application boundary for future Admin/backend configuration delivery:

```text
discover version
→ fetch one complete bundle
→ deep validate shop, stable IDs and references
→ reject stale/downgrade
→ atomically install snapshot + inventory configuration
```

Remote unavailability leaves local Operations fully usable. Invalid bundles preserve the last-known-good snapshot. Omitted old inventory definitions are retained inactive rather than destructively deleted, preserving historical references. Initial device provisioning uses the same install path.

## Browser fallback

IndexedDB is a first-class local fallback. The database has an explicit ordered migration registry: v1 creates the initial schema and v2 adds hot operational and causal sync indexes. Tests open a populated v1 fixture, upgrade through production migration code and verify data/index preservation.

## Remote status

No new TUX V2 Supabase project exists in this repository state. No remote migration has been applied, no service-role credential is present, and RLS remains deny-by-default pending the later reviewed auth/device-enrollment phase.

## Delivery after End Day

The approved product behavior still allows a Delivery Order to be marked DONE when it leaves the restaurant and later become RETURNED if delivery fails. If End Day closes first, the product contract does not yet define the later correction model. Operations intentionally preserves the approved current semantics rather than inventing a state or reopening rule; see ADR 0011.

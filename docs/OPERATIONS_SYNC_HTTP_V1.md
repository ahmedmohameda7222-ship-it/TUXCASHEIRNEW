# TUX V2 Operations Sync HTTP Contract — V1

Status: **repository-side contract only**. No Supabase project is connected or deployed by this document.

## Boundary

A successful local Operations command is authoritative immediately after its local transaction commits. The outbox transports immutable committed facts later. Remote synchronization must never be required for checkout, Board actions, Expenses, Bulk Stock, or End Day.

The V1 sender posts one `OperationsSyncEnvelopeV1` per request. The endpoint is configured outside the repository. Production receiver authentication is intentionally a deployment-time boundary until the new V2 Supabase project and its auth model exist. Do not weaken RLS or commit a bearer/service secret to make repository tests pass.

## Envelope

The sender runtime-validates the envelope before network delivery. `payloadVersion` is `1` and `payload.eventType` must exactly match `eventType`.

```text
eventId              immutable local OutboxEvent UUID
shopId               owning shop UUID
businessDayId        Business Day UUID or null where contract permits
aggregateType
aggregateId
eventType
idempotencyKey       immutable logical event identity
payloadVersion       1
payload               discriminated OperationsSyncPayloadV1
createdAt             exact local outbox timestamp
```

`ORDER_PLACED` carries the complete immutable `OrderSnapshot`, the exact Delivery customer-contact upsert snapshot when applicable, exact `ORDER_CONSUMPTION` movement snapshots, and configuration version. Order lifecycle events carry the complete updated Order plus an explicit transition snapshot with revision, from/to state, time, worker attribution, and cancellation/return details, together with exact side-effect movement/Expense snapshots.

## HTTP result classification

The client treats:

- successful `2xx` as delivered;
- network failure, timeout, `408`, `425`, `429`, and `5xx` as transient/retryable;
- deterministic other `4xx`, unsupported payload version, or invalid payload as permanent/protocol failure.

Permanent local events are quarantined durably with identity and failure reason. They are not deleted. Later events may continue; sync health must indicate attention is required. There is no worker-facing manual Sync button.

## Exactly-once receiver transaction

For every request, a future receiver must perform one Postgres transaction:

1. Runtime-validate the V1 envelope and payload.
2. Canonicalize the validated envelope and calculate a SHA-256 payload/envelope hash.
3. Look up `operations_sync_event_receipts` by `event_id` and by `(shop_id, idempotency_key)`.
4. If a receipt already exists with the same immutable identity and hash, return success without applying mutations again.
5. If the same event ID or idempotency key exists with a different hash/identity, return a deterministic conflict response; never overwrite the first fact.
6. Insert the receipt row and deterministic materialization mutations in the **same database transaction**.
7. Apply `buildRemoteMaterializationPlanV1(envelope)` in order. Every mutation is an idempotent upsert on the specified immutable/natural key. Every row's `shop_id` must equal the envelope shop.
8. Commit the receipt and all normalized state together. If any mutation fails, roll the whole transaction back so the event remains retryable from the sender.
9. Return `2xx` only after durable commit.

The receipt table is added by `20260820023000_operations_sync_domain_parity.sql`. RLS is enabled without a permissive policy. Service-role/function authentication is not finalized until the real V2 project exists.

## Deterministic table mapping

`packages/sync/src/remoteMaterializer.ts` is the repository-owned executable mapping contract.

- `BUSINESS_DAY_STARTED` / `BUSINESS_DAY_CLOSED` → `business_days`.
- `WORKER_SIGNED_IN` / `WORKER_SWITCHED` / `WORKER_SIGNED_OUT` → exact current/previous `worker_sessions`.
- `ORDER_PLACED` → optional `customer_contacts`, `orders`, `order_items`, modifier/combo child snapshots, `payments`, one `order_status_events` placement row using `eventId`, and exact `inventory_movements`.
- Done / Undo / Cancel / Delivery Failed → updated `orders`, one exact attributed `order_status_events` row using `eventId`, exact compensating inventory movements, and exact Delivery Failed Expense when applicable.
- Manual Expense create/edit/delete → one authoritative `expenses` row including revision/update/delete lifecycle metadata.
- Bulk Stock → exact `inventory_movements` row.
- End Day reconciliation → `reconciliations` plus all `reconciliation_lines`.

No receiver path generates a new domain ID. `order_item_modifiers`, `order_item_combo_beverages`, and `reconciliation_lines` have no local UUID in their domain snapshots; the parity migration therefore changes those remote rows to committed parent/position or parent/method natural identity instead of fabricating UUIDs.

## Migration application order — future manual deployment

When the new V2 Supabase project exists, apply manually and in timestamp order:

1. `20260817195000_operations_foundation.sql`
2. `20260817195500_tenant_integrity.sql`
3. `20260820023000_operations_sync_domain_parity.sql`

This correction does **not** apply any migration remotely. Real receiver authentication, deployment, migration application, and the final Supabase-connected Electron end-to-end validation remain external blockers.

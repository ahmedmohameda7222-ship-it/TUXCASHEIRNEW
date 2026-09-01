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

The authenticated Operations device/session transport is present in the repository. Remote materialization policy remains separately guarded by the deterministic parsing and mutation rules above.

## Inbound configuration and activation

`OperationsConfigurationSyncService` is the application boundary for backend configuration delivery:

```text
discover version
→ fetch one complete bundle
→ deep validate shop, stable IDs and references
→ reject stale/downgrade
→ atomically install snapshot + inventory configuration
```

Remote unavailability preserves an already installed last-known-good configuration. Invalid bundles preserve the last-known-good snapshot. Omitted old inventory definitions are retained inactive rather than destructively deleted, preserving historical references. Initial device provisioning uses the same install path.

A fresh installation is not trusted merely because a shop/worker identity was cached. Operations becomes activated only when exactly one active local shop and a validated durable configuration snapshot for that shop coexist. Therefore a crash or remote/configuration failure after identity persistence but before configuration installation cannot turn a half-provisioned browser/Desktop installation into an offline-authenticated worker session after restart.

## Worker authentication: online authority versus offline fallback

Worker PIN entry has one narrow offline exception rather than a generic “try local when anything remote fails” rule.

When remote authority is available, its authenticated worker identity is authoritative. On success, Operations persists the returned active worker and transitions by that exact worker ID. It never chooses the operator by scanning cached matching PIN hashes after an online success. This prevents PIN reassignment or duplicate cached hashes from attributing Business Day/session/audit/outbox state to the wrong worker.

Local cached PIN verification is used only when the remote/device-session boundary reports genuine transport unavailability **and** the installation is already activated. The following are explicitly not offline-fallback signals:

- invalid/deactivated worker PIN;
- invalid, expired/revoked or unauthorized device session;
- throttling;
- malformed/protocol-invalid remote response;
- ordinary server errors that are not classified as transport unavailability;
- local credential/session persistence failure;
- fresh or partially provisioned installation.

For browser device-session refresh, transport loss returns an explicit unavailable outcome without destroying durable cookies. An authoritative refresh-token rejection clears the device cookies and rejects authentication. A malformed refresh response is a protocol failure. Only an actual worker `invalid_pin` response may fence a matching stale cached worker credential.

Desktop uses the same application semantics through typed device-session resolution: transport unavailable, authoritative invalid, protocol error, local persistence error and not-enrolled are distinct outcomes rather than exception-message guesses.

## Bootstrap brute-force and provenance boundary

First-use browser bootstrap is an exceptional unauthenticated PIN path and therefore has stricter abuse controls. The Vercel server derives the rate-limit identity from deployment-trusted `x-vercel-forwarded-for`; caller-controlled device IDs, labels, User-Agent and spoofable request inputs cannot rotate the bucket. Missing trusted source information collapses into one conservative unresolved bucket.

The Edge Function does not trust a body `rateLimitKey` merely because the caller knows the Supabase publishable key. Vercel signs the normalized bootstrap request with HMAC-SHA256 using the server-only `TUX_BOOTSTRAP_HMAC_SECRET`. The signature binds timestamp, nonce, rate-limit key, device identity/label and PIN. The Edge function verifies signature/freshness before any Supabase access, atomically claims the nonce, and only then consumes the PIN rate-limit bucket. A replay is rejected before it can consume or rotate another rate-limit attempt.

The same high-entropy `TUX_BOOTSTRAP_HMAC_SECRET` (minimum 32 UTF-8 bytes) must be configured at the Vercel server and `device-bootstrap` Edge Function. The value is deployment secret material and is never browser-visible or committed to source control.

## Browser fallback

IndexedDB is a first-class local fallback. The database has an explicit ordered migration registry: v1 creates the initial schema and v2 adds hot operational and causal sync indexes. Tests open a populated v1 fixture, upgrade through production migration code and verify data/index preservation.

## Remote status

This repository contains the reviewed Supabase schema, device enrollment/authentication/configuration/sync Edge Functions, worker PIN rate-limit policy, and append-only bootstrap replay-protection migration. Repository CI applies the complete migration chain only to an ephemeral loopback PostgreSQL instance and exercises the relevant security behavior.

No remote migration, Edge Function deployment, Vercel deployment or secret mutation is performed by this security-closeout work. Deployment operators must provision required environment secrets separately and apply repository migrations through the normal reviewed release process.

## Delivery after End Day

The approved product behavior still allows a Delivery Order to be marked DONE when it leaves the restaurant and later become RETURNED if delivery fails. If End Day closes first, the product contract does not yet define the later correction model. Operations intentionally preserves the approved current semantics rather than inventing a state or reopening rule; see ADR 0011.

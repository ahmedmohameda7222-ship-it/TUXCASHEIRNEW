# ADR 0009: Outbox aggregate dependency and monotonic materialization

## Status

Accepted — 2026-08-20

## Context

A single permanently malformed event must not stall unrelated Orders/Expenses for the whole shop. Conversely, allowing a later correction for the same aggregate to pass a quarantined predecessor can corrupt remote causal state. Retry order alone is insufficient after restarts or concurrent delivery.

## Decision

Revisioned aggregate streams carry `aggregateRevision`. Permanent failure quarantines the failed event and durably blocks/quarantines dependent later revisions for that same `(shopId, aggregateType, aggregateId)` stream. Unrelated aggregates continue. Transient failure retains ordered retry/backoff and does not advance the stream.

Remote materialization is also monotonic: Order/Expense lifecycle writes require higher revisions; Business Day cannot regress CLOSED → OPEN; ended Worker Sessions cannot be overwritten by stale open snapshots; customer contact learning is timestamp-ordered. Order lifecycle events update lifecycle/current-state fields only and never rewrite immutable placement facts or `configuration_version`.

## Consequences

The remote receiver must honor the materialization guards and apply the event receipt plus mutations atomically. A permanent bad event produces explicit operator/admin observability work rather than a busy-loop or silent stream corruption.

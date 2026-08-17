# ADR 0007 — Inventory movement ledger

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX has two inventory tracking modes: recipe consumption inferred from placed orders and manual whole-unit Bulk Stock events. Both require auditability, retry safety, cancellation behavior, and non-destructive Undo.

A mutable `stock = value` field cannot explain how a balance was reached and makes accidental corrections impossible to audit.

## Decision

Inventory balance is derived from immutable signed movements.

Tracking modes:

```text
RECIPE_TRACKED
BULK_MANUAL
```

Quantities use exact fixed-point `StockQuantityMicros` where one whole unit is 1,000,000 micro-units.

Movement facts include explicit type, signed quantity delta, worker, timestamp, optional Business Day/order, idempotency key, and optional compensated-movement reference.

Undo records a compensating movement rather than deleting or rewriting the original movement.

## Alternatives considered

- Direct stock overwrite: rejected because it erases audit history.
- Floating-point quantity ledger: rejected because repeated recipe fractions can accumulate binary rounding error.
- Separate unrelated Bulk Stock model: rejected because both modes benefit from one movement/audit infrastructure while preserving distinct worker UX.

## Consequences

Balances are reproducible from history and survive Business Day boundaries. Later Admin adjustments can use an explicit `ADMIN_ADJUSTMENT` movement rather than bypassing the ledger.

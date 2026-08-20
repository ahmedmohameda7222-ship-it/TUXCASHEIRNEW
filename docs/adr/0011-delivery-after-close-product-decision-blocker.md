# ADR 0011: Delivery-after-close semantics remain a product-decision blocker

## Status

Blocked pending explicit product decision — 2026-08-20

## Context

Approved Operations documentation contains contradictory expectations around Delivery outcomes that occur after a Business Day has already been closed. Choosing an accounting/reconciliation ownership rule implicitly would change product semantics and historical reporting.

## Decision

Final stabilization does not invent a policy. Current Operations preserves the already-approved in-day lifecycle behavior (`DONE Delivery → RETURNED / Delivery Failed`) and the closed-day invariants already implemented. Any cross-Business-Day/post-close Delivery correction behavior remains blocked until the product owner resolves which Business Day, reconciliation and financial reporting rules are authoritative.

## Consequences

This is intentionally not marked PASS in release evidence. A future decision must amend the product contract first, then add explicit domain/application/persistence/sync tests before implementation.

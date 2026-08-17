# ADR 0005 — Business Day identity

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX shifts cross midnight. Calendar dates therefore cannot safely scope orders, Expenses, reconciliation, operator sessions, or display order numbering.

The old pattern of clearing/resetting operational state to create a fresh day would destroy audit history and create identity collisions.

## Decision

Business Day is a first-class entity with immutable UUID identity and explicit `OPEN` / `CLOSED` state.

Every shift-owned operational record references `businessDayId`.

Only one Business Day may be OPEN per shop. The database enforces this rule.

Display order numbering belongs to the Business Day:

```text
Business Day A: #1 ... #52
Business Day B: #1 ...
```

Global Order UUIDs never reset. The current single-device allocator advances `lastAllocatedDisplayOrderNo` inside the local transaction boundary.

Midnight has no state transition effect.

## Alternatives considered

- Calendar date as shift key: rejected because one Business Day may span two dates and two Business Days may touch the same calendar date.
- Global display-order counter: rejected because the approved worker-facing number resets per Business Day.
- Delete/archive-and-reset rows at End Day: rejected because historical truth must remain queryable and immutable.

## Consequences

Operational queries scope by open Business Day ID, not `today()`. Future multi-device display-number coordination can replace the allocator implementation without changing Order identity or Business Day semantics.

# ADR 0004 — Exact Money minor units

**Status:** Accepted  
**Date:** 2026-08-17

## Context

Orders, discounts, delivery fees, split payments, Expenses, expected payment totals, reconciliation, and variance must agree exactly. Binary floating-point arithmetic is not an acceptable accounting model.

## Decision

Represent TUX money as `MoneyMinor`, a branded safe integer.

All business arithmetic uses exact integer addition/subtraction. Display formatting is a separate presentation concern.

Persistence uses integer/bigint money columns and validates non-negative values where the business fact cannot be negative. Reconciliation difference may be signed.

## Alternatives considered

- JavaScript floating point plus `.toFixed()`: rejected because formatting does not repair accounting semantics.
- A decimal dependency: not required for the current currency/price model because integer minor units represent the required precision exactly.
- Whole EGP only: rejected as unnecessarily restrictive for future configured prices/fees.

## Consequences

One value model can be reused across Orders, payments, Expenses, reconciliation, receipts, and future Admin reports. Parsing/form input boundaries must convert to Money explicitly instead of passing arbitrary numbers into domain logic.

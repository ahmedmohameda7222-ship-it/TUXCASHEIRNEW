# TUX Web Order Request Expiry — Approved Decision

Date: 2026-09-02
Status: Approved product decision; implementation not started
Companion spec: `docs/superpowers/specs/2026-09-02-tux-customer-web-order-bridge-design.md`

## Binding rule

A TUX-MENU `WEB_ORDER_REQUEST` remains actionable for exactly **2 hours from request creation** unless it reaches a terminal state earlier.

At `createdAt + 2 hours`, any request that is not already `ACCEPTED` or `REJECTED` becomes `EXPIRED` and cannot be accepted afterward.

This applies to requests in `AWAITING_WHATSAPP`, `RECEIVED`, and `UNDER_REVIEW`.

`EXPIRED` is terminal. A worker must not revive or convert an expired request into an official Operations order. The customer must create a fresh request so products, prices, availability, delivery configuration, and payment preference are re-evaluated from current canonical configuration.

Expiry is based on the authoritative server-side creation timestamp, not the customer device clock or Operations laptop clock.

The implementation must enforce expiry below the UI layer and atomically with acceptance so a request cannot cross the two-hour boundary and still create an official order due to a race.

## Acceptance examples

- Request created at 18:00 and accepted at 19:59:59: eligible, subject to normal Review revalidation.
- Request created at 18:00 and acceptance attempted at 20:00:00 or later: reject as `EXPIRED`; create no official order.
- Request opened for Review before 20:00 but accepted after 20:00: reject as `EXPIRED`; opening Review does not pause the expiry clock.
- Request already `ACCEPTED` before expiry: the official order remains valid; expiry never mutates accepted orders.

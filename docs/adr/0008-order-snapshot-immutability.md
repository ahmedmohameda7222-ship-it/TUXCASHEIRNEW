# ADR 0008 — Order snapshot immutability

**Status:** Accepted  
**Date:** 2026-08-17

## Context

Future Admin changes will rename products, change prices, reorder payment methods, change delivery zones/fees, and update worker display names. Historical receipts and reports must still describe the transaction that actually occurred.

Allowing placed Orders to reference only mutable configuration would rewrite history implicitly.

## Decision

A placed Order stores immutable commercial snapshots for the facts required to reproduce its receipt/report meaning.

Snapshots include, as applicable:

- product name and unit price;
- modifier label and price;
- included combo beverage;
- item and order notes;
- order type label/behavior;
- customer/phone/address/zone for Delivery;
- configured and final Delivery Fee;
- payment method label and stable logic type;
- operator display-name attribution;
- exact subtotal, discount, delivery fee, and total.

Configuration IDs remain attached for traceability, but historical display/accounting does not depend on reading current configuration values.

Placed Order commercial content is not updated in place. Cancellation, Done, Undo Done, and Delivery Return are explicit audited transitions/events.

## Alternatives considered

- Join current configuration when rendering history: rejected because history would change after Admin edits.
- Editable historical order blob: rejected because corrections would erase the original business fact.
- Copy only total: rejected because receipts, inventory, and audit require structured item/payment/fulfillment detail.

## Consequences

Historical data is larger but independently truthful. Future Admin correction tools must create explicit audited corrections rather than mutating the original commercial snapshot.

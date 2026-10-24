# Production Sync and Online Claim Recovery Specification

Operations browser transports must invoke the native browser fetch function with its global receiver while preserving injected fetch doubles. A real Chromium checkout must emit an Operations sync POST, receive an explicit `APPLIED` or `REPLAY` receipt, retain immutable event identity, and materialize the same canonical Order row consumed by Admin. Inventory and lifecycle browser transports use the same receiver-safe mechanism.

Online-order ownership errors are protocol conflicts, not backend outages. A PENDING request with a reservation owned by another device remains exclusive for the existing 12-hour processing window. After that reservation becomes stale, a claimant from the same shop may atomically take ownership of the same reserved processing Order ID; recent ownership, a live PROCESSING lease, cross-shop access, and concurrent competing claims remain fenced. Explicit release removes ownership and permits a fresh reservation.

No production deployment, live database mutation, IndexedDB clearing, Branch + PIN UX change, Order ID replacement during stale takeover, or weakening of shop/device authorization is allowed.

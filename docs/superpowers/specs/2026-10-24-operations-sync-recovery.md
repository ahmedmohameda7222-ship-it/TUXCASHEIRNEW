# Operations Sync Recovery Specification

The implementation must trace and repair the Operations delivery path from local order creation and IndexedDB outbox persistence through `/api/operations-sync`, the Vercel gateway, the Supabase Edge Function, canonical database materialization, and Admin order reads.

Requirements:

- Preserve offline-first checkout, existing local Orders, event idempotency, and branch isolation.
- Authentication or transport failures must retain events for retry; no event may be deleted or duplicated.
- Reconnection must trigger delivery promptly.
- `Offline` means browser connectivity is actually unavailable. Delivery failures show `Retrying`.
- `Synced` requires a clear active-shop queue after a completed delivery check.
- Diagnostics expose pending count, last successful delivery, last error, and retry timing/state without secrets or customer payloads.
- Focused tests cover failed delivery, retry scheduling, reconnect recovery, pending Orders, and the canonical order row consumed by Admin.
- Do not change Branch + PIN UX, deploy, merge, clear IndexedDB, or modify live data.

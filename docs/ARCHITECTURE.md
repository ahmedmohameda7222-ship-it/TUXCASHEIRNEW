# TUX V2 Operations Architecture

## Scope and package boundaries

TUX V2 is an npm-workspaces TypeScript repository. The current product is **Operations only**. TUX Admin remains a future separate application; Operations exposes no Admin tab.

```text
apps/operations             React worker renderer
apps/operations-desktop     Electron main/preload runtime
packages/domain              domain types, invariants, deep runtime parsers
packages/application         serialized commands and application ports
packages/persistence         SQLite + IndexedDB + durable drafts
packages/platform-contracts  narrow preload API
packages/sync                automatic outbox + receiver/materialization policy
packages/printing            immutable receipt renderer
packages/config              runtime environment validation
packages/ui                  shared tokens
```

Dependency direction is renderer → application → domain/persistence ports → selected adapter. The renderer never receives raw SQLite, Node, filesystem, unrestricted IPC, secrets or a native printer object.

## Local-first command boundary

All business-critical Operations commands are authoritative after a successful durable local commit. Network availability is not on the success path for Orders, Orders Board, Expenses, Bulk Stock or End Day.

`ApplicationCommandCoordinator` serializes authoritative business mutations. Hardware printing is deliberately **outside** that shared critical section and outside local database transactions:

```text
exclusive command section
  resolve current Business Day/operator/configuration
  validate and idempotency-check
  commit Order + inventory + audit + outbox atomically
release command lock
post-commit
  print fresh placement once
  rotate/reset draft safely
  return post-commit warning if printing failed
```

A slow printer therefore cannot serialize unrelated business commands after the Order is durable. Idempotent replay never automatically prints a duplicate receipt.

## Orders and durable draft recovery

Placed Orders are immutable commercial snapshots. Lifecycle transitions change only operational lifecycle state/revision; item/payment/price/fulfillment/operator/configuration-version placement facts remain historical.

Drafts persist separately in SQLite/IndexedDB. Every checkout intent has a stable key. On workspace load, if a surviving draft points to an Order that already committed before a crash, Operations automatically rotates to a fresh checkout intent and reports `PREVIOUS_ORDER_ALREADY_SAVED`. It does not reprint and does not delete a newer draft that already advanced.

## Electron security boundary

The packaged desktop renderer uses:

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- `webSecurity: true`;
- webviews disabled;
- restrictive renderer CSP;
- validated main-frame IPC sender identity;
- no raw `ipcRenderer` exposure.

Development renderer URLs are limited to loopback port 5173. Production loads the built local renderer. SQLite lives under Electron `app.getPath('userData')`.

## Printing boundary

`ReceiptPrinterConfiguration` supports an optional `deviceName`, 58/80 mm paper width, copy count and explicit fallback-to-default policy. Electron maps that contract to `webContents.print()`; no machine-specific printer is hardcoded. The native adapter also has a test-print capability boundary without adding worker-facing Admin/device UI.

Print failure remains a post-commit warning and never rolls back a saved Order.

## Configuration architecture

Operations stores one complete validated versioned configuration snapshot per shop. `OperationsConfigurationSyncService` provides the inbound backend boundary:

```text
remote version discovery
→ fetch complete unknown JSON bundle
→ deep runtime validation + shop/ref integrity
→ monotonic version check
→ one local transaction
   configuration snapshot replacement
   inventory configuration reconciliation
→ last-known-good remains available offline
```

Invalid, cross-shop or stale bundles cannot damage/downgrade the local snapshot. Initial device provisioning uses the same validation/application path. Historical Orders are never rewritten when configuration changes.

An Operations installation is considered activated only when exactly one active local shop identity and a validated durable configuration snapshot for that shop coexist. A partially persisted bootstrap identity without configuration does not become a trusted worker session after restart. A previously activated installation may continue from its last-known-good configuration when the remote configuration authority is later unavailable.

## Device and worker authentication trust boundary

Worker authentication distinguishes **remote authority**, **device-session authority**, and the explicitly allowed **offline fallback** path.

For an activated installation with network authority available, the server-returned worker identity is authoritative. Successful online authentication persists that worker and transitions the local session by the exact authoritative worker ID; it does not rescan cached PIN hashes to choose an operator. The transaction re-reads that exact worker and validates that it remains active for the same shop before creating or switching Business Day/session/audit/outbox state.

Cached local PIN verification is used only when the remote boundary reports genuine transport unavailability. Device/session rejection, invalid/malformed protocol state, throttling, local credential persistence failure, and other server errors are not offline signals and cannot silently fall through to cached authentication. Browser and Electron adapters map their transport-specific failures into the same application-level semantics.

Browser device-session refresh has typed outcomes: transport failure preserves durable cookies and becomes an unavailable signal; authoritative refresh-token rejection clears the device cookies and becomes device-session invalid; malformed refresh responses are protocol errors. Only an actual worker `invalid_pin` response is treated as worker credential rejection/fencing.

## Worker PIN bootstrap abuse boundary

First-use browser PIN bootstrap is routed through the Vercel server boundary. The brute-force bucket is derived only from deployment-trusted `x-vercel-forwarded-for`; browser-generated device IDs, labels, User-Agent and other caller-controlled headers/body values do not create new buckets. If the trusted source header is absent, requests deliberately collapse into one conservative unresolved bucket instead of accepting a spoofable fallback identity.

The Supabase `device-bootstrap` Edge Function does **not** trust the public/anon API credential or a caller-provided abuse key as proof that a request passed through Vercel. The server signs a canonical bootstrap request with HMAC-SHA256 using the server-only `TUX_BOOTSTRAP_HMAC_SECRET`. The signed material binds timestamp, one-time nonce, normalized abuse key, device identity/label and PIN. The Edge Function verifies signature and bounded timestamp in constant time before any Supabase access, then atomically claims the nonce before touching the PIN rate limiter. Replays are rejected and cannot create a second rate-limit attempt.

`TUX_BOOTSTRAP_HMAC_SECRET` must be configured with the same high-entropy value at the Vercel server and the `device-bootstrap` Edge Function. It is deployment secret material, must contain at least 32 UTF-8 bytes, and must never be exposed to the browser, checked into the repository, or replaced by the Supabase publishable key.

## Persistence

Desktop SQLite uses ordered repository migrations and typed repositories. Browser fallback uses an explicit IndexedDB migration registry; v1 creates the initial stores and v2 adds operational hot-path and causal-outbox indexes. Upgrades execute every intermediate migration and preserve business data.

Inventory is append-only. Bulk Stock undo/corrections create compensating movements; worker UI has no stock-overwrite API.

## Automatic outbox and remote receiver foundation

Outbox events carry aggregate stream identity plus a causal aggregate revision when ordering matters. A permanent origin failure quarantines that event and dependent later revisions for the same aggregate while unrelated aggregates continue. The blocked state is durable across restart and pending queries exclude quarantined work.

Before any remote mutation plan is produced, the Operations Sync V1 envelope is reconstructed from `unknown` through deep runtime validation: nested entity IDs, timestamps, enums, exact integer money/quantities, modifiers/combo data, delivery/customer state, lifecycle revisions and cross-object shop/Business-Day identities are checked.

Remote materialization plans are monotonic:

- Orders use `operational_revision` and lifecycle updates are narrow `UPDATE`s that cannot erase immutable placement fields such as `configuration_version`.
- Expenses use `lifecycle_revision`.
- Customer contacts use monotonic `last_order_at` semantics.
- Worker sessions and Business Days cannot be reopened/regressed by stale lifecycle writes.

Device enrollment, authenticated Operations configuration/worker-auth routes, and the Operations Sync transport scaffolding are present in the repository. Their deployment is outside this repository-only closeout; no production Supabase/Vercel change is performed by the implementation task itself.

## Postgres/Supabase repository schema

`supabase/migrations/*.sql` defines the normalized remote-compatible schema, tenant integrity, lifecycle/domain parity and sync receipt table. Authentication/device migrations also define the Operations device identity, worker PIN rate limiter, and private bootstrap replay nonce store. CI applies the full chain from zero against ephemeral PostgreSQL with only a minimal test `auth.users` compatibility stub representing the Supabase-managed auth table.

The bootstrap replay table is private and its nonce-claim RPC is executable only by `service_role`; public, anon and authenticated roles cannot claim or inspect replay state. Historical migrations are not rewritten—the provenance guard is append-only.

No remote Supabase migration or Edge Function deployment is performed as part of this repository state.

## Windows desktop packaging

`electron-builder.yml` packages the built renderer/main/preload into an x64 Windows NSIS target. Packaging does not depend on a Vite dev server and excludes the development provisioning tool. CI validates an unsigned Windows artifact. Production code signing remains an explicit external release-credential step.

## Unresolved product invariant

The approved product contract still permits Delivery to become DONE when it leaves the restaurant and later become RETURNED for Delivery Failed. End Day may close while that DONE order is still considered final. The repository does **not** invent a new state or alter End Day semantics; see `docs/adr/0011-delivery-after-close-product-decision-blocker.md`.

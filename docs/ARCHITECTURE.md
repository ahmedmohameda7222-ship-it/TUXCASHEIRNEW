# TUX V2 Architecture

## Repository shape

TUX V2 uses an npm-workspaces TypeScript repository. Operations has one React renderer shared by Electron and browser fallback rather than independent desktop/browser business applications.

```text
apps/operations
  React renderer

apps/operations-desktop
  Electron main + sandboxed preload

packages/domain
  IDs, Money, Business Day, Orders, payments, Expenses,
  inventory, reconciliation, audit, configuration contracts

packages/application
  serialized application commands, typed Results/errors,
  Orders/Orders Board/session services and native capability ports

packages/persistence
  shared repository/transaction contract
  SQLite desktop adapter
  IndexedDB browser adapter

packages/platform-contracts
  typed renderer/preload capability contract

packages/sync
  later automatic remote sync worker

packages/printing
  pure immutable-receipt renderer shared by runtime print adapters

packages/config
  runtime environment validation

packages/ui
  TUX design tokens/shared UI ownership
```

TUX Admin is not implemented. Future Admin is expected to reuse domain/config/database contracts rather than duplicate them.

## Dependency direction

```text
React UI
  -> application commands
  -> domain rules
  -> persistence interfaces
  -> selected runtime adapter

React UI
  -X-> raw SQLite
  -X-> filesystem
  -X-> arbitrary IPC
  -X-> Supabase service credentials
```

Domain code has no React dependency.

## Electron security boundary

The Electron renderer is treated as untrusted web content. Native capability crosses a narrow typed preload bridge.

The desktop window uses context isolation and sandboxing with renderer Node integration disabled, `webSecurity` enabled, and webviews disabled. New windows and arbitrary renderer navigation are denied. Development content is restricted to `http://localhost:5173` or `http://127.0.0.1:5173`; packaged content loads from the local Operations build. IPC handlers validate the expected renderer `webContents` and its main frame before servicing a call. Raw `ipcRenderer` is never exposed.

The renderer HTML carries a restrictive Content Security Policy.

Orders uses the same boundary. The renderer receives only typed Orders commands from preload; it never receives a SQLite handle or native printer object. Receipt reprint IPC accepts a validated immutable `OrderId` and returns a structurally validated application result.

## Domain model

Phase 2 establishes explicit branded IDs and exact value types:

```text
MoneyMinor
StockQuantityMicros
Instant
BusinessDayId / OrderId / WorkerId / ...
```

Business Day is a first-class OPEN/CLOSED entity. Display order numbering is Business-Day scoped and independent from immutable Order UUIDs.

Placed orders are structured historical snapshots. Commercial/payment/fulfillment/item facts remain immutable after checkout; Phase 5 adds explicit operational lifecycle metadata (`revision`, `doneAt`, cancellation, return) updated only through narrow audited transitions. Payment business behavior uses stable logic types rather than display-name comparisons. Delivery Failed Expenses use `amount = null` semantics. Inventory uses an append-only movement ledger with exact signed quantity micro-units.

Phase 4 adds a durable `OrderDraft` model with a runtime-local draft scope, revision, and stable checkout intent key. Product quantity/customization, combo beverages, delivery-zone fee snapshots, exact discount/payment calculations, phone normalization, and smart Cash tenders are domain/application concerns rather than JSX calculations.

## Orders command boundary

`OperationsOrdersService` owns Orders workspace loading, durable draft saves, customer lookup, checkout, and receipt reprint.

Checkout follows this sequence:

```text
validate complete draft
→ serialized application command
→ one local database transaction
   → allocate Business-Day display number
   → write immutable order/items/payments snapshot
   → append exact inventory movements
   → learn successful Delivery contact
   → append audit event
   → append durable outbox event
→ commit locally
→ attempt receipt print for a fresh commit only
→ rotate/clear the durable draft
```

A local transaction failure returns a blocking application error and leaves the durable draft available. An idempotent replay returns the already committed Order without repeating order, inventory, audit, outbox, or automatic printing effects.

Renderer draft edits are serialized through one save queue. Desktop stores drafts in SQLite; browser fallback stores them in IndexedDB. Stale revisions are rejected rather than silently overwriting a newer draft.

## Orders Board command boundary

`OperationsOrdersBoardService` owns current-Business-Day Board loading and the approved operational transitions only: `ACTIVE → DONE`, bounded Done Undo back to `ACTIVE`, `ACTIVE → CANCELLED`, and `DONE Delivery → RETURNED`. There is no general edit/reopen API and no multi-stage kitchen state model.

Every Board transition re-reads the current open Business Day and target order inside the local command boundary. The persistence update is intentionally narrow: it starts from the already saved order and replaces only `status`/lifecycle metadata, preserving items, fulfillment, operator, prices, totals, payments, numbering and receipt history.

Cancellation is compensating rather than destructive. A not-prepared cancellation appends positive `CANCEL_RESTOCK` movements linked to the original negative `ORDER_CONSUMPTION` movements. A prepared cancellation leaves consumption unchanged. Delivery Failed never restores inventory; it atomically writes RETURNED lifecycle state, a linked `DELIVERY_FAILED` expense with `amount = null`, audit facts, and a durable outbox event while the historical order total/payment snapshot stays intact.

The Orders Board renderer uses the same typed application boundary in browser fallback and narrow validated Electron IPC on desktop. It never receives raw storage/native access.

## Receipt printing boundary

Receipt content is generated by the pure `@tux/printing` package from the immutable saved `OrderSnapshot`.

Desktop printing is implemented by an `OrderPrinter` application port and an Electron-main adapter. The adapter creates a hidden sandboxed receipt window and calls Electron `webContents.print()` only after local checkout success. Browser fallback uses the same receipt HTML through an isolated hidden iframe and the browser print dialog.

Print failure does not roll back a committed order. The application returns `PRINT_FAILED`; the renderer keeps the new post-checkout draft and exposes Retry/Reprint against the saved `OrderId`. Recovered/idempotent checkout does not automatically print because previous print status cannot be proven; it returns `PRINT_STATUS_UNKNOWN` and requires an intentional reprint.

## Local persistence boundary

`OperationsDatabase` exposes one transaction callback containing typed repositories for:

- shop/device/worker/session identity;
- versioned Operations configuration snapshot;
- customer contacts;
- Business Days;
- orders;
- Expenses;
- inventory items/movements;
- reconciliation;
- audit events;
- durable outbox.

Application commands can write a business mutation and its outbox intent atomically.

Durable Orders drafts deliberately live behind a separate `OrderDraftStore` contract because draft editing is not a placed-business transaction. Both SQLite and IndexedDB adapters provide revision-aware draft persistence; checkout business effects still occur only inside `OperationsDatabase.transaction()`.

### Desktop SQLite

Desktop storage uses Node's `node:sqlite` behind the native boundary.

Current baseline:

- single database connection;
- foreign keys enabled;
- `synchronous = FULL`;
- `BEGIN IMMEDIATE` transaction boundaries;
- versioned migration table;
- default rollback journal rather than WAL for the current single-device writer model.

The SQLite physical schema stores essential constrained/indexed columns plus JSON aggregate payloads. This is deliberate local-device storage, not the remote reporting schema.

### Browser IndexedDB

Browser fallback implements the same repository/transaction contract with IndexedDB.

- versioned object stores;
- strict-durability hint on business transactions;
- persistent-storage request where available;
- atomic versioned Operations configuration snapshot.

Browser persistence has weaker platform guarantees than the desktop SQLite store and must not be represented otherwise.

## Configuration consistency

Remote Postgres normalizes menu/payment/order-type/delivery-zone/recipe data for Admin/reporting integrity.

Local Operations stores the validated configuration as one versioned aggregate per shop so startup never renders a partially synchronized catalog. Future Admin/sync can replace that snapshot transactionally.

## Remote Postgres/Supabase

`supabase/migrations/20260817195000_operations_foundation.sql` defines the normalized remote Operations/future-Admin schema.

It includes tenant/shop scope, devices/workers, Business Days, menu/configuration, recipes/inventory, Orders/items/payments, customer contacts, Expenses, reconciliation, and audit.

RLS is enabled on exposed `public` tables, but no permissive policies are created yet. No real V2 Supabase project is linked, no credentials are committed, and no remote migration has been applied.

## TypeScript

The shared compiler baseline enables strict checking plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, and unknown catch variables.

Third-party declaration checking is isolated where current Node/Vite/Electron declarations overlap; strict checking remains enabled for TUX source code.

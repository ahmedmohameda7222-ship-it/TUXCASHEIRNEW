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
  application Result/error primitives; commands expand in later phases

packages/persistence
  shared repository/transaction contract
  SQLite desktop adapter
  IndexedDB browser adapter

packages/platform-contracts
  typed renderer/preload capability contract

packages/sync
  later automatic remote sync worker

packages/printing
  later receipt/print adapters

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

## Domain model

Phase 2 establishes explicit branded IDs and exact value types:

```text
MoneyMinor
StockQuantityMicros
Instant
BusinessDayId / OrderId / WorkerId / ...
```

Business Day is a first-class OPEN/CLOSED entity. Display order numbering is Business-Day scoped and independent from immutable Order UUIDs.

Placed orders are structured immutable snapshots. Payment business behavior uses stable logic types rather than display-name comparisons. Delivery Failed Expenses use `amount = null` semantics. Inventory uses an append-only movement ledger with exact signed quantity micro-units.

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

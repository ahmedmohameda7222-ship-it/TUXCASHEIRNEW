# TUX V2 Migration Strategy

## Rule

All durable schemas are versioned. Integrated migrations are append-only: new schema evolution adds a new migration rather than rewriting historical migration meaning.

No repository command applies migrations to a production or remote Supabase project.

## Desktop SQLite

`packages/persistence/src/sqlite/migrations.ts` owns the local desktop migration registry. `local_schema_migrations` records each version and name.

Current chain:

1. `operations_foundation` — local Operations tables, exact constraints, core indexes and durable outbox.
2. `one_open_worker_session_per_business_day` — one Current Operator session per Business Day.
3. `orders_board_lookup_indexes` — order-linked inventory lookup.
4. `outbox_permanent_failure_quarantine` — durable quarantine metadata.
5. `outbox_aggregate_dependency_ordering` — aggregate revisions, dependency blocking and supporting indexes.

Each migration is applied inside `BEGIN IMMEDIATE`; a failed migration rolls back and is not recorded as applied.

SQLite tests create earlier-version databases, reopen them with current code, and verify preserved records plus new constraints/indexes.

## Browser IndexedDB

`packages/persistence/src/browser/indexedDbMigrations.ts` is the explicit browser schema registry. Browser upgrades are not one-shot creation logic hidden inside the adapter.

Current chain:

1. `initial_operations_schema` — all Operations object stores and original indexes.
2. `operational_query_and_outbox_dependency_indexes` — indexed Business-Day/query paths plus aggregate-stream outbox indexing.

`applyIndexedDbMigrations()` requires every intermediate version to exist and refuses a skipped/missing migration. Automated tests cover both fresh v2 creation and a populated v1 → v2 upgrade without business-data loss. The rendered Playwright harness also seeds a real v1 browser database before loading current Operations, exercising the production upgrade path.

The browser physical schema need not mirror normalized PostgreSQL table-for-table; it must preserve the same Operations facts and atomic boundaries.

## Repository PostgreSQL/Supabase chain

The repository carries, in filename order:

1. `20260817195000_operations_foundation.sql`
2. `20260817195500_tenant_integrity.sql`
3. `20260820023000_operations_sync_domain_parity.sql`

The third migration adds parity needed by the local-first sync protocol: Current Operator uniqueness, Expense lifecycle fields, Order operational lifecycle/configuration-version fields, parent-position identities for nested snapshots, order-status revision data, and the durable `operations_sync_event_receipts` idempotency receipt table.

## Migration-chain smoke gate

`npm run test:migrations` requires `TUX_TEST_DATABASE_URL` and deliberately refuses non-loopback hosts. It resets only that local test database, creates the minimal `auth.users` compatibility table supplied by Supabase in production, applies every repository migration in filename order with `psql -v ON_ERROR_STOP=1`, then asserts critical tenant FKs, lifecycle constraints, Current Operator uniqueness, sync-receipt presence, and RLS enablement.

GitHub Actions supplies a clean PostgreSQL service for this gate. This proves SQL compile/order/invariant integrity; it does **not** claim to emulate the complete Supabase Auth/runtime platform.

## Production deployment boundary

Real V2 Supabase project creation, credentials, RLS policy design for authenticated clients/service roles, backup/restore rehearsal, and production migration application are external deployment work. They remain unconfigured until explicitly authorized.

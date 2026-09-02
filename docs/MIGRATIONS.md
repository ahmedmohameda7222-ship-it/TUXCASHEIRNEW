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

The complete PostgreSQL/Supabase migration chain is the ordered set of SQL files currently committed under `supabase/migrations/`. The repository files, in filename order, are the schema source of truth; this document deliberately does not freeze another duplicate numbered list that can become stale as append-only migrations are added.

The current Production reconciliation for every repository migration is recorded in [`docs/deployment/SUPABASE_REMOTE_MIGRATION_LEDGER.md`](deployment/SUPABASE_REMOTE_MIGRATION_LEDGER.md).

Repository migration truth and Supabase remote migration-history metadata are distinct records. A migration can have a verified Production schema/data effect even when `supabase_migrations.schema_migrations` has no corresponding row, for example when SQL was applied through an authorized Dashboard workflow. Missing history metadata is therefore a reconciliation signal, not an instruction to replay SQL or manually edit migration history.

Historical migration SQL remains immutable in meaning. Any new schema evolution must be represented by a new append-only migration file.

## Migration-chain smoke gate

`npm run test:migrations` requires `TUX_TEST_DATABASE_URL` and deliberately refuses non-loopback hosts. It resets only that local test database, creates the minimal `auth.users` compatibility table supplied by Supabase in production, applies every repository migration in filename order with `psql -v ON_ERROR_STOP=1`, then asserts critical tenant FKs, lifecycle constraints, Current Operator uniqueness, sync-receipt presence, and RLS enablement.

GitHub Actions supplies a clean PostgreSQL service for this gate. This proves SQL compile/order/invariant integrity; it does **not** claim to emulate the complete Supabase Auth/runtime platform and it does **not** mutate Production.

## Production deployment boundary

A Production Supabase project is deployed and its repository migration effects have been reconciled. The detailed observed remote state, including aligned history entries, the historical timestamp alias, and effect-verified migrations whose history entries are absent, is maintained in the [Production remote migration ledger](deployment/SUPABASE_REMOTE_MIGRATION_LEDGER.md).

Production migration application remains an explicit operator-controlled boundary. Repository commands and CI do not apply, replay, repair, or record migrations against Production. An approved Production migration is applied only through the authorized deployment workflow, its remote effects are independently verified, and the ledger is then updated with the evidence actually observed.

Do not infer that a missing `supabase_migrations.schema_migrations` row means a migration has not taken effect. Do not casually or manually mutate that history table to force metadata alignment. Reconcile repository SQL, remote history metadata, and independently verified Production effects deliberately.

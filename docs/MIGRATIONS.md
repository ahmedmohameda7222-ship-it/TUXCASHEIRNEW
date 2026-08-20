# TUX V2 Migration Discipline

## Durable migration chains

TUX Operations has different physical stores behind one shared domain/persistence contract.

```text
Desktop local SQLite
  packages/persistence/src/sqlite/migrations.ts

Browser IndexedDB
  versioned inside the browser persistence adapter

Remote Postgres/Supabase
  supabase/migrations/*.sql
```

## SQLite

SQLite migrations are append-only once integrated. Phase 3 does not rewrite the Phase 2 foundation migration.

Current chain:

```text
1  operations_foundation
2  one_open_worker_session_per_business_day
```

Migration v1 creates the local operational transaction store.

Migration v2 adds:

```sql
CREATE UNIQUE INDEX ux_worker_sessions_one_open_per_business_day
ON worker_sessions(business_day_id)
WHERE ended_at IS NULL;
```

This means the durable desktop store permits at most one currently open worker session for a Business Day. Switching workers closes the old session before inserting the new one in the same application transaction.

The migration runner:

1. creates `local_schema_migrations` if necessary;
2. loads applied versions;
3. executes each new migration inside `BEGIN IMMEDIATE`;
4. records its version/name/applied timestamp only after the migration SQL succeeds;
5. rolls back on failure.

Future integrated schema changes must add a new migration rather than silently rewriting historical migration meaning.

## IndexedDB

The browser adapter currently uses database version `1`.

Any future schema change must increment the IndexedDB version and perform deterministic `upgradeneeded` transformations. Never delete/recreate production stores simply to avoid writing a migration.

The browser schema is not expected to mirror normalized Postgres table-for-table. It preserves the same domain facts required by Operations. Phase 3 serializes session commands within the browser service, but does not claim the SQLite v2 uniqueness constraint has an equivalent cross-tab IndexedDB database constraint.

## Postgres / Supabase

The repository remote chain contains:

```text
supabase/migrations/20260817195000_operations_foundation.sql
supabase/migrations/20260817195500_tenant_integrity.sql
```

The first migration establishes the normalized remote V2 foundation. The second hardens same-shop composite relationships and removes duplicated mutable revenue/collection facts that should be derived from authoritative status/payment history.

The remote schema includes shop/tenant scope, future authenticated memberships/devices, workers with PIN hash fields only, Business Days/sessions, normalized configuration, exact numeric storage, Orders/history snapshots, customer contacts, Expenses, inventory movement ledger, reconciliation, audit, constraints/indexes, and RLS enabled on exposed `public` tables.

No permissive RLS policy is created yet. The real V2 remote authorization model must be reviewed before client row access is opened.

## Remote application rule

Do not run a remote migration command until the user supplies and explicitly authorizes the real V2 target.

When that target exists:

1. verify it is not the legacy Tuxcashier project;
2. inspect the complete repository migration chain;
3. run the chain against a local/ephemeral Postgres/Supabase environment first;
4. verify constraints, indexes and RLS;
5. only then apply to the authorized target;
6. verify the resulting remote schema matches Git history.

No secret or project reference belongs in a migration file.

## Current validation status

SQLite migrations are executed by automated tests against `node:sqlite`. Phase 3 specifically verifies that the v2 index rejects a second simultaneous open worker session for the same Business Day.

The Postgres migration chain remains repository-reviewed but unapplied because no approved V2 Supabase target or local Supabase stack is connected. That distinction remains explicit in release reporting.

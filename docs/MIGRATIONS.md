# TUX V2 Migration Discipline

## Two migration chains

TUX Operations has two durable database targets with different physical schemas and one shared domain contract.

```text
Desktop local SQLite
  packages/persistence/src/sqlite/migrations.ts

Remote Postgres/Supabase
  supabase/migrations/*.sql
```

Browser IndexedDB schema evolution is versioned inside the browser persistence adapter and must evolve in lockstep with the local domain semantics.

## SQLite

The current baseline migration is version `1` / `operations_foundation`.

It creates the local operational transaction store and is executed by `applySqliteMigrations`.

The migration runner:

1. creates `local_schema_migrations` if necessary;
2. loads applied versions;
3. executes each new migration inside `BEGIN IMMEDIATE`;
4. records its version/name/applied timestamp only after the migration SQL succeeds;
5. rolls back on failure.

Phase 2 is still before a released production database, so the version-1 baseline may be refined on its feature branch. After a schema version is integrated/released, future changes must add a new migration rather than silently rewriting historical migration meaning.

## IndexedDB

The browser adapter currently uses database version `1`.

Any future schema change must increment the IndexedDB version and perform deterministic `upgradeneeded` transformations. Never delete/recreate production stores simply to avoid writing a migration.

The browser schema is not expected to mirror normalized Postgres table-for-table. It must preserve the same domain facts and transaction semantics required by Operations.

## Postgres / Supabase

The repository contains:

```text
supabase/migrations/20260817195000_operations_foundation.sql
```

It is the first remote V2 schema migration and has not been remotely applied.

The remote migration includes:

- shop/tenant scope;
- future authenticated memberships/devices;
- workers with PIN hash fields only;
- Business Days and sessions;
- normalized menu/configuration;
- exact money columns;
- exact fixed-point inventory quantities;
- Orders/items/customizations/payments with historical snapshots;
- customer contacts;
- Expenses including non-financial Delivery Failed semantics;
- inventory movement ledger;
- reconciliation facts;
- audit events;
- relational constraints/indexes;
- RLS enabled on exposed public tables.

No permissive RLS policy is created yet. The real V2 remote authorization model must be reviewed before client data access is opened.

## Remote application rule

Do not run a remote migration command until the user supplies and explicitly authorizes the real V2 target.

When that target exists:

1. verify it is not the legacy Tuxcashier project;
2. inspect the complete repository migration chain;
3. run the chain against a local/ephemeral Postgres/Supabase environment first;
4. verify constraints/indexes/RLS;
5. only then apply to the authorized target;
6. verify the resulting remote schema matches Git history.

No secret or project reference belongs in a migration file.

## Current validation status

SQLite migrations are executable in automated tests against `node:sqlite` and exercise initialization/transaction behavior.

The Postgres migration is repository-reviewed but Phase 2 does **not** claim engine application yet because no approved V2 Supabase target or local Supabase stack is connected in this workflow. That distinction must remain explicit in release reporting.

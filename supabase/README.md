# TUX V2 Supabase migrations

This directory is the authoritative remote Postgres/Supabase schema history for TUX V2.

## Current state

No real V2 Supabase project is linked or configured.

`migrations/20260817195000_operations_foundation.sql` is intentionally **unapplied remotely**. It defines the Operations/future-Admin data foundation so the schema can be reviewed and versioned before a production target exists.

Do not:

- link this repository to the legacy Tuxcashier Supabase project;
- add a project ref, URL, anon key, service-role key, access token, or database password to Git;
- run a remote `supabase db push` without explicit target-project authorization;
- bypass the migration chain by editing a future remote schema directly.

## Security posture

The foundation migration enables Row Level Security on every table in the exposed `public` schema but deliberately creates no permissive client policies yet. Until the real V2 authentication/device authorization model is approved and implemented, browser/API roles should not receive row access through these tables.

Worker PIN identity is operational identity and is not the remote authorization boundary. Worker records store a secure hash field only; plaintext production PINs do not belong in source control or durable normal records.

## Validation status

The migration is versioned and reviewed in Git, but Phase 2 does not claim that it has been applied to a local Supabase/Postgres engine or any remote project. Local SQLite migrations are executable and covered by automated tests. A future authorized Supabase setup must run the complete repository migration chain against the real V2 target and verify constraints, indexes, and RLS before application connectivity is enabled.

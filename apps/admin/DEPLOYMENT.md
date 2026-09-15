# TUX Admin Deployment Contract

TUX Admin remains deployment-disabled in Git during Plans 1–9. Production activation is a Plan 10 release action after the reviewed reliability, migration, secret, and smoke-test gates pass.

## Server-only scheduler secret

`CRON_SECRET` is required by every Admin scheduled route. It is a server-only deployment secret and must never be exposed through Vite/browser environment variables, client bundles, logs, screenshots, or documentation values.

The production scheduler invokes `/api/cron/admin-config-scheduler` every minute. The cron expression is only a wake-up cadence; due work is selected from canonical absolute timestamps in PostgreSQL, while Admin scheduling semantics remain `Africa/Cairo`.

## Safe smoke procedure

Before enabling production traffic in Plan 10:

1. Apply the reviewed Admin migrations to the explicitly authorized production Supabase project using the Plan 10 migration procedure. Do not apply Plan 2 migrations independently.
2. Configure the Admin project's server-only Supabase URL/service-role key and `CRON_SECRET`.
3. Send an unauthenticated `GET /api/cron/admin-config-scheduler`; with `CRON_SECRET` configured it must return `401 unauthorized` and execute no work. If the secret is absent, the route must fail closed with `503 cron_secret_not_configured`.
4. Send an authenticated GET with `Authorization: Bearer <CRON_SECRET>`. A healthy no-work invocation may return `200` with zero claimed/applied/failed counts.
5. Confirm that the route accepts no caller-supplied business command payload. It must derive bounded due work from the canonical scheduler table and execute through the same trusted catalog RPCs used by server paths.
6. Confirm a claimed job cannot be claimed by a second worker during its lease, and that an expired claim can be safely reclaimed after the configured lease interval.

Do not paste production secret values into tickets, chat, CI output, or test fixtures.

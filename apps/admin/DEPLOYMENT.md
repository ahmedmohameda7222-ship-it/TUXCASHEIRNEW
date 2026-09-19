# TUX Admin Deployment Contract

TUX Admin is a **separate Vercel project** from the same TUX monorepo, rooted at `apps/admin`.

## Import state

The Operations Vercel cutover is complete and production-verified from the app-local Operations boundary. The repository root `/vercel.json` is absent, so a fresh Admin import rooted at `apps/admin` must resolve the Admin app-local contract instead of the former Operations contract.

If a Vercel New Project form was opened before this cleanup, cancel it and start a fresh import from the latest `main`. Do not deploy if the form still shows any Operations build command or `apps/operations/dist`.

For initial Git-link verification after creating the Admin Vercel project, a harmless `main` change under `apps/admin` must create an Admin deployment for that commit.

Configure the Admin project with:

- Root Directory: `apps/admin`
- Include source files outside Root Directory: **Enabled**
- Framework Preset: `Vite`
- Install Command: `cd ../.. && npm ci`
- Build Command: `cd ../.. && npm run build:admin`
- Output Directory: `dist`

Because the Admin install/build commands intentionally reach the monorepo root and the Admin app consumes shared workspace packages, outside-root source access must remain enabled.

`apps/admin/vercel.json` is the repository deployment contract for Admin. `apps/menu/vercel.json` remains the Menu contract, and `apps/operations/vercel.json` is the Operations contract.

Admin `/api/*` functions, including `/api/cron/*`, are resolved through the filesystem before the final SPA fallback to `/index.html`. Do not replace that route ordering with a catch-all rewrite that intercepts API functions.

## Git deployment policy

Admin Git deployments are enabled for `main` only:

- pushes/merges to `main` deploy;
- PR previews remain disabled;
- feature-branch deployments remain disabled.

The repository policy is:

```json
"git": {
  "deploymentEnabled": {
    "**": false,
    "main": true
  }
}
```

Use `**`, not `*`, so slash-named feature branches are also disabled.

This project boundary only enables normal Admin deployment from `main`. **Final production acceptance is still Plan 10** and remains responsible for the reviewed reliability, migration, secret, environment, and smoke-test acceptance gates.

## Server-only scheduler secret

`CRON_SECRET` is required by every Admin scheduled route. It is a server-only deployment secret and must never be exposed through Vite/browser environment variables, client bundles, logs, screenshots, or documentation values.

The production scheduler invokes `/api/cron/admin-config-scheduler` every minute. The approval execution runner invokes `/api/cron/admin-approval-executor` every minute. The cron expressions are only wake-up cadences; due work is selected from canonical state in PostgreSQL.

## Safe smoke procedure

Before accepting Admin production in Plan 10:

1. Apply the reviewed Admin migrations to the explicitly authorized production Supabase project using the Plan 10 migration procedure.
2. Configure the Admin project's server-only Supabase URL/service-role key and `CRON_SECRET`.
3. Send an unauthenticated `GET /api/cron/admin-config-scheduler`; with `CRON_SECRET` configured it must return `401 unauthorized` and execute no work. If the secret is absent, the route must fail closed with `503 cron_secret_not_configured`.
4. Send an authenticated GET with `Authorization: Bearer <CRON_SECRET>`. A healthy no-work invocation may return `200` with zero claimed/applied/failed counts.
5. Confirm that scheduled routes accept no caller-supplied business command payload that bypasses the trusted server/RPC boundaries.
6. Confirm a claimed job cannot be claimed by a second worker during its lease, and that an expired claim can be safely reclaimed after the configured lease interval.

Do not paste production secret values into tickets, chat, CI output, or test fixtures.

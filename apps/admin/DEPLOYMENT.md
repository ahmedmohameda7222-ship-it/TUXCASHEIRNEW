# TUX Admin Deployment Contract

TUX Admin is intended to be its own **separate Vercel project** from the same TUX monorepo, rooted at `apps/admin`.

## Current migration gate

The repository still contains the legacy root `/vercel.json` used by the live Operations project. The real Vercel New Project import UI can preload that root Operations build/install/output contract even after `apps/admin` is selected. Therefore **do not create the Admin project until the existing Operations project has been cut over to `apps/operations` and the legacy root `/vercel.json` has been removed in the follow-up cleanup**.

The repository-side Admin target contract remains:

- Root Directory: `apps/admin`
- Include source files outside Root Directory: **Enabled**
- Framework Preset: `Vite`
- Install Command: `cd ../.. && npm ci`
- Build Command: `cd ../.. && npm run build:admin`
- Output Directory: `dist`

Because the Admin install/build commands intentionally reach the monorepo root and the Admin app consumes shared workspace packages, outside-root source access must remain enabled.

After the Operations cutover and root cleanup, `apps/admin/vercel.json` is the only repository deployment contract applicable to an Admin project rooted at `apps/admin`. `apps/menu/vercel.json` remains the Menu deployment contract, and `apps/operations/vercel.json` becomes the Operations deployment contract.

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

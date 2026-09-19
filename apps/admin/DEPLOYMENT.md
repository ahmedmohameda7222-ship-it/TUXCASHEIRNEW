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

## Vercel Cron Jobs

Vercel Cron Jobs are disabled for the Admin project. The Admin `vercel.json` intentionally has no `crons` property, so deploying Admin does not register scheduled jobs.

The existing scheduler/approval HTTP handlers remain fail-closed internal endpoints, but Vercel does not invoke them on a schedule in this deployment profile. `CRON_SECRET` is therefore not required to deploy Admin while Vercel Cron Jobs remain disabled.

## Safe smoke procedure

Before accepting Admin production in Plan 10:

1. Apply the reviewed Admin migrations to the explicitly authorized production Supabase project using the Plan 10 migration procedure.
2. Configure the Admin project's server-only Supabase URL/service-role key.
3. Confirm the deployed Admin project registers no Vercel Cron Jobs.
4. Confirm the dormant scheduler/approval HTTP endpoints fail closed when no `CRON_SECRET` is configured.
5. If scheduled execution is reintroduced in a later reviewed plan, reintroduce its authentication and scheduling contract explicitly rather than enabling it implicitly.

Do not paste production secret values into tickets, chat, CI output, or test fixtures.

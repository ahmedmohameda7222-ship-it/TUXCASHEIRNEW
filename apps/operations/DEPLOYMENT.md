# TUX Operations Vercel Deployment Contract

## Cutover status: complete

The existing Operations Vercel project `tuxcasheirnew` is now on the app-local monorepo boundary:

- Root Directory: `apps/operations`
- Include source files outside Root Directory: **Enabled**
- Framework Preset: `Vite`
- Install Command: `cd ../.. && npm ci`
- Build Command: `cd ../.. && npm run build -w @tux/operations`
- Output Directory: `dist`

The cutover was production-verified with deployment `dpl_9M6i179C83S6Hzry2rumFm9Tqx68` from `main` commit `4afea2c27d9cc561a55089ffef5a3fc402cd849e`. It reached `READY` and retained the existing production alias `tuxcasheirnew-three.vercel.app` without an alias error.

The repository-root `/vercel.json` is absent in the final repository state. `apps/operations/vercel.json` is the only Operations Vercel project contract.

## Runtime/API preservation

Operations stays compatible with the Vercel Hobby limit of at most 12 Serverless Functions per deployment. The app-local API currently deploys 11 Functions.

Most repository-root Operations API handlers retain a matching app-local passthrough entrypoint under `apps/operations/api/**`. The device and worker route families are intentionally consolidated to keep the deployment below the Hobby function limit:

- `/api/device-bootstrap`, `/api/device-enroll`, and `/api/device-session` transparently rewrite to the single `apps/operations/api/device.ts` dispatcher;
- `/api/worker-auth`, `/api/worker-menu-layout`, and `/api/worker-ui-preferences` transparently rewrite to the single `apps/operations/api/worker.ts` dispatcher.

The dispatchers delegate to the existing repository-root handlers instead of duplicating business logic, so the public route names and handler semantics are preserved.

The app-local entrypoints import handlers and shared packages outside `apps/operations`, so **Include source files outside Root Directory must remain enabled**. That project setting makes the workspace sources available during the monorepo build, while the app-local Vercel contract also sets `functions["api/**/*.ts"].includeFiles` to `../../packages/{domain,application}/src/**` so the raw workspace TypeScript runtime graph is physically packaged into each Serverless Function that needs it. Both parts of the deployment boundary are required: build-time visibility alone does not guarantee Function-bundle inclusion.

The app-local contract preserves:

- the existing `/api/whatsapp-media-retention` cron schedule;
- the six public device/worker API route names through transparent rewrites;
- the existing main-only Git deployment policy;
- the existing ignore command;
- the Operations workspace build command;
- the existing production domain/alias.

Do not manually invoke `/api/whatsapp-media-retention` as a smoke test because it is an operational retention job.

## Future changes

Any Operations deployment change must be made in `apps/operations/vercel.json` and covered by `npm run test:admin-deployment`. `scripts/test-admin-deployment-contract.mjs` enforces the approved passthrough/dispatcher topology and rejects an Operations deployment that exceeds 12 Serverless Functions. `scripts/test-operations-vercel-hobby-budget.mjs`, `scripts/test-operations-vercel-route-rewrites.mjs`, `scripts/test-operations-vercel-esm-imports.mjs`, and `scripts/test-operations-vercel-runtime-bundle.mjs` provide focused regression coverage in the dedicated Hobby deployment workflow, including the external workspace Function-bundle contract.

New root `api/**/*.ts` handlers should remain passthrough entrypoints unless they are deliberately consolidated with equivalent public-route rewrites and regression coverage. Do not add an app-local API file that pushes the Operations deployment over the Hobby limit. Any new runtime dependency outside `apps/operations` must remain traceable and, when Vercel file tracing does not package it automatically, must be covered by the explicit Function `includeFiles` contract and its regression guard.

The previous `READY` production deployments remain available as rollback artifacts; changing repository deployment contracts does not require changing the production domain.

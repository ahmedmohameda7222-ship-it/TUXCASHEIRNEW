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

Every repository-root Operations API function has a matching app-local entrypoint under `apps/operations/api/**`. Each entrypoint delegates to the existing root handler instead of duplicating business logic, preserving deployed route names and behavior.

Those wrappers import handlers and shared packages outside `apps/operations`, so **Include source files outside Root Directory must remain enabled**.

The app-local contract preserves:

- the existing `/api/whatsapp-media-retention` cron schedule;
- the existing main-only Git deployment policy;
- the existing ignore command;
- the Operations workspace build command;
- the existing production domain/alias.

Do not manually invoke `/api/whatsapp-media-retention` as a smoke test because it is an operational retention job.

## Future changes

Any Operations deployment change must be made in `apps/operations/vercel.json` and covered by `npm run test:admin-deployment`. Any new root `api/**/*.ts` handler must have the recursively mirrored `apps/operations/api/**/*.ts` entrypoint enforced by that regression gate.

The previous `READY` production deployments remain available as rollback artifacts; changing repository deployment contracts does not require changing the production domain.

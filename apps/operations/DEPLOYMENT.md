# TUX Operations Vercel Cutover Contract

Operations currently remains live through the repository-root Vercel project and the root `/vercel.json`. That legacy contract must stay in place until the existing production project has been switched to the app-local root and a successful production deployment has been verified.

## App-local target contract

After the repository-side preparation is merged, the existing Operations project can be moved to:

- Root Directory: `apps/operations`
- Include source files outside Root Directory: **Enabled**
- Framework Preset: `Vite`
- Install Command: `cd ../.. && npm ci`
- Build Command: `cd ../.. && npm run build -w @tux/operations`
- Output Directory: `dist`

The app-local `apps/operations/vercel.json` preserves the existing main-only Git policy, the existing `/api/whatsapp-media-retention` cron schedule, and the existing ignore command.

## Runtime/API preservation

Every existing repository-root `api/*.ts` Operations function has an app-local entrypoint under `apps/operations/api/*.ts`. Each entrypoint delegates to the existing root handler instead of duplicating business logic. This preserves the deployed route names and behavior while allowing Vercel to discover the functions from the new project Root Directory.

Because those entrypoints import the existing root handlers and the Operations workspace consumes shared monorepo packages, **Include source files outside Root Directory must be enabled** before the cutover deployment.

## Cutover verification trigger

When Vercel skips an empty commit as an unaffected monorepo change, a documentation-only change inside `apps/operations` may be used to force one production build after the Root Directory setting changes. This does not change Operations runtime behavior.

## Zero-downtime sequence

1. Merge the repository preparation that adds this app-local contract and the app-local API entrypoints.
2. Confirm CI and Codex review are green.
3. In the existing Operations Vercel project, change Root Directory from the repository root to `apps/operations`.
4. Enable **Include source files outside Root Directory**.
5. Confirm the project settings resolve to the app-local values above.
6. Deploy the current `main` commit and wait for that deployment to reach Ready.
7. Verify the existing Operations production domain, all existing `/api/*` routes used by Operations, and `/api/whatsapp-media-retention`.
8. Only after that verification may the legacy repository-root `/vercel.json` be removed in a separate repository change.
9. Do not create the Admin Vercel project until that root cleanup is merged, because the Vercel New Project import UI can otherwise preload the repository-root Operations commands.

Changing the project Root Directory does not require changing the production domain. The previous Ready production deployment remains the rollback target until the new app-local deployment is verified.

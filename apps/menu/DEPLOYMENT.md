# Deployment Guide — TUX Menu (Phase A)

TUX Menu is an independent Vite + React browser application inside the canonical `ahmedmohameda7222-ship-it/TUXCASHEIRNEW` monorepo. The Operations application remains a separate Vercel project and retains authority for Operations, API routes, and cron behavior.

## Vercel project contract

Configure the Menu Vercel project with:

- Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
- Root Directory: `apps/menu`
- Framework: Vite
- Install command: `cd ../.. && npm ci`
- Build command: `cd ../.. && npm run build:menu`
- Output Directory: `dist`
- SPA rewrite: `/(.*)` → `/index.html`

The repository has one authoritative npm lockfile at the monorepo root. Do not add or restore `apps/menu/package-lock.json`. Menu deployment must install from the root lock and build the `@tux/menu` workspace from the repository root.

## Monorepo commands

Run these commands from the repository root:

```bash
npm ci
npm run dev:menu
npm run typecheck:menu
npm run build:menu
npm run test:e2e:menu
```

The production build output is `apps/menu/dist/`.

## Browser-visible legacy Supabase configuration

Phase A uses only these Menu-specific Vite browser variables for the legacy Menu/Admin backend:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Both values are exposed to browser code by Vite. They must therefore contain only the public Supabase project URL and anonymous/public key.

Do **not** place a Supabase service-role key, private server secret, `TUX_SUPABASE_*` private credential, or any other privileged secret in the Menu application or its Vite environment.

If the two `VITE_SUPABASE_*` values are omitted, the fallback catalog remains available, while legacy dynamic Supabase-backed Menu/Admin behavior is unavailable.

## WhatsApp ordering

During Phase A, the WhatsApp order destination remains configured in `src/lib/constants.ts`. It is not a private server credential and is not moved into the Supabase environment variables by this phase.

## Architecture boundary

Root `supabase/migrations/` is the only executable database migration authority. The file under `apps/menu/legacy/supabase_setup.sql.reference` is historical reference material only and must never be executed or copied into canonical migrations.

Canonical catalog/API ownership and standalone Admin extraction belong to later approved phases; Phase A does not perform those cutovers. The temporary `/admin` route remains inside Menu during Phase A; standalone `apps/admin` is mandatory Phase C work.

# Deployment Guide — TUX Menu (Phase A)

TUX Menu is a Vite + React browser application inside the TUX monorepo. During Phase A, its dynamic Menu/Admin data path still uses the legacy Supabase browser client. The fallback catalog can render without Supabase configuration, but dynamic legacy Menu/Admin data requires the browser-visible variables below.

## Monorepo commands

Run these commands from the repository root:

```bash
npm ci
npm run dev:menu
npm run typecheck:menu
npm run build:menu
```

The production build output is `apps/menu/dist/`.

## Browser-visible legacy Supabase configuration

Phase A uses only these Vite browser variables for the legacy Menu/Admin backend:

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

Canonical catalog/API ownership and standalone Admin extraction belong to later approved phases; Phase A does not perform those cutovers.

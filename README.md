# TUX V2

Long-term TypeScript rebuild of TUX Operations. Product implementation is developed through phase branches into `integration/tux-operations-v2`; `main` is reserved for the final user-approved Operations integration.

The legacy `ahmedmohameda7222-ship-it/Tuxcashier` repository is read-only reference only.

## Current scope

- `apps/operations` — shared React Operations renderer for Electron and browser fallback.
- `apps/operations-desktop` — secure Electron main/preload shell.
- `packages/application` — application-level result/error primitives; business commands arrive in later phases.
- `packages/config` — validated runtime configuration with remote backend disabled by default.
- `packages/platform-contracts` — narrow typed Electron preload contract.
- `packages/ui` — TUX design tokens.

No TUX Admin application is implemented in the current Operations build.

## Foundation commands

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev:operations
```

Copy `.env.example` only when local overrides are needed. Real secrets and production worker PINs must never be committed.

## Canonical specification

`docs/TUX_V2_Operations_Master_Approved_Plan.md` is the binding Operations product contract.

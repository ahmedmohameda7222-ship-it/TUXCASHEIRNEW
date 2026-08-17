# TUX V2 Architecture

## Current implemented foundation

TUX V2 uses an npm-workspaces TypeScript repository. The current Operations renderer is a single React application shared by desktop and browser fallback. The Electron application is a shell around that renderer rather than a second Operations implementation.

```text
apps/operations
  React renderer + view-only state

apps/operations-desktop
  Electron main + sandboxed preload

packages/application
  Result and application error primitives

packages/config
  Runtime configuration validation

packages/platform-contracts
  Type-only renderer/preload capability contract

packages/ui
  TUX design tokens
```

Phase 2 will add domain and persistence packages; they are intentionally not faked in Phase 1.

## Dependency direction

```text
renderer UI
  -> application/config/type contracts
  -> later domain/application commands

renderer UI
  -X-> filesystem
  -X-> raw SQLite
  -X-> arbitrary IPC
  -X-> privileged secrets
```

The Electron renderer is treated as untrusted web content. Native capability must cross a narrow typed preload bridge.

## TypeScript

The shared compiler baseline enables strict checking plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, and unknown catch variables. TypeScript 6.0.x is deliberately pinned during Phase 1 because the current stable typescript-eslint line officially supports TypeScript `<6.1.0`.

## Local-first status

The local durable database and outbox are Phase 2 work. Phase 1 does not claim local-first business durability yet and implements no checkout or Business Day business mutation.

## Remote backend status

Remote backend configuration defaults to `disabled`. No Supabase URL, key, project reference, or remote migration is present.

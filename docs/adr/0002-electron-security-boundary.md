# ADR 0002 — Electron security boundary

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX Operations will gain privileged desktop capabilities such as local SQLite and printing. Exposing Node.js or a generic IPC channel to renderer code would make renderer compromise equivalent to machine-level capability compromise.

## Decision

Treat the renderer as untrusted web content.

Every BrowserWindow uses:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

The preload bridge exposes explicit typed methods only. Phase 1 exposes a single harmless `app.getVersion()` method to establish the pattern. Raw `ipcRenderer`, filesystem APIs, SQLite handles, shell execution, and secrets are not exposed.

Sandboxed preload code remains a single runtime module unless a dedicated preload bundling decision is made later, because Electron's sandboxed preload environment does not support ordinary ESM imports.

## Alternatives considered

- `nodeIntegration: true`: rejected as an unnecessary renderer privilege.
- Generic `invoke(channel, payload)`: rejected because it defeats capability narrowing.
- Direct SQLite in renderer: rejected because persistence must remain behind native/application boundaries.

## Consequences

New native features require explicit contract design and IPC handlers. This costs a small amount of boilerplate but makes privilege review and testing tractable.

# ADR 0002 — Electron security boundary

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX Operations will gain privileged desktop capabilities such as local SQLite and printing. Exposing Node.js, arbitrary remote content, or a generic IPC channel to renderer code would make a renderer compromise equivalent to broad machine-capability compromise.

## Decision

Treat the renderer as untrusted web content and expose native capability only through explicit typed methods.

Every BrowserWindow uses:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
webviewTag: false
```

The desktop shell also:

- denies new-window creation;
- prevents renderer-initiated navigation;
- accepts development content only from `http://localhost:5173` or `http://127.0.0.1:5173`;
- loads packaged Operations content from the local build;
- validates the expected renderer `webContents` and main frame before servicing IPC;
- uses a restrictive renderer Content Security Policy.

The preload bridge exposes explicit typed methods only. Phase 1 exposes a single harmless `app.getVersion()` method to establish the pattern. Raw `ipcRenderer`, filesystem APIs, SQLite handles, shell execution, and secrets are not exposed.

Sandboxed preload code remains a single runtime module unless a dedicated preload bundling decision is made later, because Electron's sandboxed preload environment does not support ordinary unrestricted Node module access.

## Alternatives considered

- `nodeIntegration: true`: rejected as unnecessary renderer privilege.
- Generic `invoke(channel, payload)`: rejected because it defeats capability narrowing.
- Direct SQLite in renderer: rejected because persistence must remain behind native/application boundaries.
- Arbitrary development URLs: rejected because privileged preload capabilities must never be attached to untrusted remote content.

## Consequences

New native features require explicit contract design, IPC handlers, sender validation, and security review. This costs a small amount of boilerplate but keeps the privilege surface narrow and testable.

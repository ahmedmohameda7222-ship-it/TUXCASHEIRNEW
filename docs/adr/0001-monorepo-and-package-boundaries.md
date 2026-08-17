# ADR 0001 — Monorepo and package boundaries

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX V2 needs one Operations UI that runs in Electron and in a browser fallback, and future TUX Admin must reuse business rules without duplicating them.

## Decision

Use npm workspaces with application shells under `apps/` and deliberate shared boundaries under `packages/`. Keep React presentation, native Electron capability, application/domain rules, persistence, and remote sync as separate responsibilities.

Phase 1 creates only boundaries that own real foundation code. Domain/persistence/sync packages arrive when their implementation starts rather than as empty architecture theater.

## Alternatives considered

- One application directory: simpler initially, but encourages business/native code coupling and makes future Admin reuse expensive.
- Separate web and Electron Operations implementations: rejected because it duplicates product behavior.
- Many micro-packages from day one: rejected as unnecessary fragmentation.

## Consequences

Workspace dependency direction is explicit. Electron can host the same renderer used by the browser fallback. Future Admin can consume domain/application packages without importing Operations UI code.

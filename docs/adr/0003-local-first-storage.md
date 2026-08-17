# ADR 0003 — Local-first storage

**Status:** Accepted  
**Date:** 2026-08-17

## Context

TUX Operations must continue taking orders and closing Business Days through network/Supabase outages. A successful business action therefore cannot depend on a remote round trip, browser memory, or `localStorage`.

The same Operations UI must also have a browser fallback without duplicating business rules.

## Decision

Use an `OperationsDatabase` transaction contract shared by application code.

Desktop:

- SQLite owned by Electron/native code;
- one connection for the current single-device product;
- explicit `BEGIN IMMEDIATE` transactions;
- foreign keys enabled;
- synchronous durability set to `FULL`;
- versioned local migrations.

Browser fallback:

- IndexedDB;
- versioned object stores;
- `readwrite` transactions with strict durability hint;
- persistent-storage request where supported.

React does not receive raw SQLite, IndexedDB, filesystem, or transaction handles.

## Alternatives considered

- `localStorage`: rejected because it has no suitable transactional/durability model for POS facts.
- Remote-first Supabase writes: rejected because cloud outages must not stop valid local work.
- Two independent desktop/browser business implementations: rejected because semantics would diverge.
- Native third-party SQLite wrapper: deferred because Electron 43's Node runtime already provides `node:sqlite`; an external native dependency is not justified yet.
- WAL immediately: deferred because the current deployment is a single Operations device/process and does not need concurrent writer optimization yet.

## Consequences

Application commands can require local commit before success while sync runs later. Browser fallback has weaker environmental guarantees and must not be presented as equivalent to desktop durability. If future concurrency justifies WAL or another engine, the repository/application contract allows an adapter change without rewriting domain workflows.

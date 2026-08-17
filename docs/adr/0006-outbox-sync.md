# ADR 0006 — Durable outbox synchronization

**Status:** Accepted  
**Date:** 2026-08-17

## Context

Remote Supabase availability is not guaranteed during restaurant operation. Writing local business data first and then separately remembering to sync in React memory would lose outgoing work after crashes/restarts.

## Decision

Persist outgoing synchronization intent in a durable local outbox.

Critical application transactions can atomically record:

```text
business mutation
+
outbox event
```

Outbox events carry stable aggregate/event identity, idempotency key, versioned payload, retry metadata, and delivery status.

A later automatic sync worker reads pending events, retries with backoff, and marks delivery only after the remote operation is confirmed.

## Alternatives considered

- Manual worker Sync button: rejected because cloud mechanics are not an operator responsibility.
- Fire-and-forget network call after local save: rejected because process failure can lose unsent work.
- Remote transaction as the source of success: rejected because offline work must remain valid.

## Consequences

Remote sync may be pending after local success without corrupting the business fact. Remote handlers must be idempotent. The outbox and business mutation must share the local transaction where they represent one command outcome.

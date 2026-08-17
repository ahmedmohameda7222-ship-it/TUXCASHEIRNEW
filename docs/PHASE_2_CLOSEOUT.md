# Phase 2 — Domain + Persistence + Migration Foundation Closeout

**Phase:** 2  
**Branch:** `feat/ops-02-domain-persistence`  
**PR:** #4 → `integration/tux-operations-v2`  
**Date:** 2026-08-17

## Delivered

- strict branded UUID identities;
- exact `MoneyMinor` accounting values;
- exact fixed-point `StockQuantityMicros` inventory quantities;
- first-class OPEN/CLOSED Business Day identity and Business-Day-scoped display order allocation;
- worker/device/session and hashed-PIN credential models;
- normalized configuration/domain contracts for menu, products, modifiers, recipes, order types, payment methods, delivery zones, and customer contacts;
- immutable structured Order/payment/Delivery snapshots;
- explicit Manual Expense vs non-financial Delivery Failed Expense semantics;
- inventory movement ledger and compensating-movement model;
- reconciliation, audit, and durable outbox models;
- one runtime-independent `OperationsDatabase` transaction/repository contract;
- SQLite desktop persistence using `node:sqlite`, versioned migrations, foreign keys, `synchronous = FULL`, and explicit transaction rollback;
- IndexedDB browser fallback using the same domain transaction contract, versioned stores, persistent-storage request, and strict durability hint;
- atomic versioned local Operations configuration snapshots;
- customer-contact identity protection for normalized-phone updates;
- restart persistence tests for configuration/outbox state;
- unapplied normalized Postgres/Supabase migration chain with RLS enabled and tenant-consistent composite foreign keys;
- ADRs for local-first storage, Money, Business Day identity, outbox, inventory ledger, and immutable Order snapshots;
- synchronized Data Model, Offline/Sync, Migration, Architecture, and Test Strategy documentation.

## Remote database boundary

No real V2 Supabase project is linked or configured. No remote migration has been applied. No Supabase URL, project ref, anon key, service-role key, access token, database password, or production PIN is committed.

The remote chain is repository-only:

```text
20260817195000_operations_foundation.sql
20260817195500_tenant_integrity.sql
```

RLS is enabled on exposed `public` tables without permissive client policies. Remote policy/auth implementation remains deferred until the real V2 target and authorization model are available.

## Validation evidence

Permanent Phase 2 validation includes:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions run `32063783683` passed the full permanent chain before the final customer-contact identity hardening. The hardened branch was then revalidated through the same command chain from a downloaded branch archive before closeout. PR #4 remains subject to the permanent GitHub Actions gate on its final documentation head before squash merge.

## Compliance status discipline

The main 120-row Operations compliance matrix remains intentionally conservative. Phase 2 supplies architecture and invariants for many approved behaviors, but workflow rows are not promoted merely because their supporting models/tables exist. Orders, Orders Board, Expenses UI, Bulk Stock UI, Start Day/operator UI, and End Day/Reconciliation remain incomplete until their application commands and user workflows are implemented and verified in later phases.

## Known deferred work

- real worker PIN verification command/runtime strategy is Phase 3;
- feature application commands and checkout transaction orchestration are later phases;
- real Supabase migration engine validation/application waits for the authorized V2 target;
- automatic remote sync worker is Phase 9;
- receipt/printing workflow is later work;
- full browser E2E durability/restart behavior is validated when real workflows are wired.

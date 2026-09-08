# TUX Menu Online Orders Integration Continuation Plan

> **Status: COMPLETE.** All implementation, regression, security, migration-chain, rendered browser, Menu, desktop packaging, and repository architecture gates in this plan have been implemented and verified on the branch. PR #55 remains **DRAFT** and no production deployment/migration was performed.

**Goal:** Finish the canonical Menu → online-order intake → Operations → WhatsApp integration on `work/menu-online-orders-integration` without regressing PR #54 WhatsApp behavior or applying external production mutations.

**Architecture:** The browser remains untrusted. Menu submits canonical IDs and customer intent through the public order-intake boundary; the server validates/re-prices and stores a PENDING request; Operations receives it through the authenticated device/server path, caches it locally, explicitly claims/reviews it, and converts it through existing Operations order-placement invariants. WhatsApp reuses the same normalized Egyptian customer identity and final order context.

**Tech Stack:** TypeScript, React, Electron, Vite, Vitest, Playwright, Supabase Edge Functions/PostgreSQL, repository architecture/security guards, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-tux-canonical-catalog-authority-design.md` plus the controller prompt for TUX Menu reconciliation and canonical online-order intake.

## Global Constraints

- Branch only: `work/menu-online-orders-integration`; no commit to `main` or frozen historical branches.
- Current `main` and merged PR #54 remain authoritative for Operations/WhatsApp behavior.
- No whole-branch Phase B merge, force-push, or history rewrite.
- No remote Supabase migration/application, Vercel deployment, Meta configuration, or real WhatsApp send.
- Customer-facing Menu appearance preserved; no redesign.
- Browser does not insert canonical order rows directly and does not receive service-role credentials.
- Canonical catalog IDs and `priceMinor` remain authoritative; server re-prices requests.
- Web intake does not become a final Operations order until Business Day/operator/delivery/payment/inventory facts are established.
- Delivery customer phone normalization reuses canonical Egyptian semantics (`01XXXXXXXXX`).
- Existing PR #54 WhatsApp order-context service is reused; no duplicate WhatsApp-owned order persistence.
- TDD was used for missing behavior, including the final Codex regression round.

---

### Task 1: Finish the Electron online-order inbox IPC runtime

- [x] **Step 1: Write the failing test.**
- [x] **Step 2: Verify RED.**
- [x] **Step 3: Implement the minimal trusted IPC runtime.**
- [x] **Step 4: Verify GREEN.**
- [x] **Step 5: Commit the implementation.**

Implemented trusted `load`, `claim`, `release`, `reject`, and change-subscription IPC with sender checks, UUID/reason validation, subscription cleanup, and shutdown cleanup.

### Task 2: Expose the inbox through the existing desktop preload/platform boundary

- [x] **Step 1: Write failing preload/platform contract tests.**
- [x] **Step 2: Verify RED.**
- [x] **Step 3: Implement the narrow preload/platform bridge and main-process composition.**
- [x] **Step 4: Verify GREEN including desktop typecheck/build and WhatsApp gates.**
- [x] **Step 5: Commit the bridge/composition work.**

Desktop renderer access is limited to the preload contract. No renderer Supabase service-role/admin secret was introduced.

### Task 3: Add the minimal Operations incoming-web-order review surface

- [x] **Step 1: Write failing UI/runtime tests for PENDING/PROCESSING/offline review state.**
- [x] **Step 2: Verify RED.**
- [x] **Step 3: Implement the minimal incoming-web-order review surface.**
- [x] **Step 4: Verify GREEN including Operations build and WhatsApp regressions.**
- [x] **Step 5: Commit the Operations intake surface.**

The Orders Board shows incoming web requests separately from POS orders, uses cached-first/offline-safe state, exposes review/claim/release/reject flows, and does not fabricate final delivery/payment facts.

### Task 4: Convert a claimed request through existing Operations order-placement invariants

- [x] **Step 1: Write failing conversion/idempotency/invariant tests.**
- [x] **Step 2: Verify RED.**
- [x] **Step 3: Implement conversion through existing application/order services.**
- [x] **Step 4: Verify GREEN including SQLite/browser persistence and migration-chain smoke.**
- [x] **Step 5: Commit safe reviewed-web-intake conversion.**

Acceptance produces one durable `source = ONLINE` order using the reserved processing order ID and existing Business Day/operator/payment/delivery/inventory/audit/outbox invariants. Final hardening also recovers a committed local ONLINE order if the local accepted tombstone was interrupted.

### Task 5: Prove canonical customer/WhatsApp context reuse

- [x] **Step 1: Write integration tests for equivalent Egyptian phone representations.**
- [x] **Step 2: Verify RED where plumbing was missing.**
- [x] **Step 3: Reuse the canonical phone normalizer and existing WhatsApp order-context service.**
- [x] **Step 4: Verify GREEN including WhatsApp architecture/security gates.**
- [x] **Step 5: Commit the WhatsApp/online-order context regression coverage.**

Final ONLINE delivery orders resolve to the same logical customer/order context for canonical and Meta-style Egyptian phone representations.

### Task 6: Full local/fake-provider E2E and security matrix

- [x] **Step 1: Add happy-path and adversarial regression coverage.**
- [x] **Step 2: Verify RED only for genuinely missing behavior.**
- [x] **Step 3: Implement the narrow missing protections/plumbing.**
- [x] **Step 4: Verify GREEN across unit/integration, Menu E2E, catalog/order-intake, Operations, WhatsApp, and migration smoke.**
- [x] **Step 5: Commit the Menu → Operations → WhatsApp journey/security coverage.**

Coverage includes canonical server re-pricing/validation, duplicate/idempotent intake, authenticated Operations access, cross-shop isolation, claim/reject token protection, lease-expiry handling, browser privilege boundaries, offline/recovery behavior, final ONLINE-order context reuse, and fake-provider messaging paths.

### Task 7: Visual parity and repository closeout

- [x] **Step 1: Run rendered desktop/mobile Menu comparison evidence including cart state.**
- [x] **Step 2: Correct demonstrated visual/accessibility regressions and rerun evidence.**
- [x] **Step 3: Run the complete permanent CI matrix with exact-head evidence and no weakened gates.**
- [x] **Step 4: Record deployment prerequisites and external-mutation state.**
- [x] **Step 5: Open DRAFT PR `work/menu-online-orders-integration` → `main`; do not merge.**

## Completion evidence

- Draft PR: **#55** (`work/menu-online-orders-integration` → `main`), intentionally not merged.
- Final Codex regression specification: `2ba00a7511050224c9ebacf3fedad8aa0a30a796`.
- Final Codex production-race fixes: `f9649fa38d6ea81598bd32c6ab7486c1ab77b6d3`.
- Acceptance-lease migration fixture alignment: `e69e442840bf814833255679027c014cc5ff8729`.
- Clean permanent CI run: **34269449250** on `e69e442840bf814833255679027c014cc5ff8729`.
- Permanent CI result: architecture **GREEN**, edge-security **GREEN**, Menu typecheck/build/rendered E2E **GREEN**, Windows x64 package **GREEN**, quality **GREEN**, Required quality gate **GREEN**.
- Quality unit/integration suite: **196 files / 1145 tests passed**.
- Migration-chain smoke, Supabase function auth deployment contract, Edge Function typecheck, and rendered Operations browser E2E: **GREEN**.
- `REMOTE MIGRATIONS APPLIED: NO`.
- External deployment/configuration mutations: **NONE**.
- No Vercel deployment, Supabase remote migration, Meta configuration, production database/bucket mutation, or real WhatsApp send was performed during this repository-only phase.

The remaining repository closeout action after this document update is an exact-head permanent CI run followed by a fresh `@codex review`; any new review finding must be fixed before the PR can be considered review-clean. The PR must remain DRAFT and must not be merged without an explicit user request.

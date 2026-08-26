# TUX UI Alignment Long-Term Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved Orders Board centering, MoneyInput composition, and Expenses alignment fixes durable, responsive, and regression-protected.

**Architecture:** Keep the existing shared `MoneyInput` component as the single behavioral implementation and move its visual contract into the canonical Orders stylesheet instead of relying on a late correction override. Use overflow-safe flex alignment for Orders Board tabs, and let the shared Expenses grid drive both Add and Edit forms at desktop widths while preserving existing responsive fallbacks. Protect the result with source-level contracts plus rendered Playwright assertions.

**Tech Stack:** React, TypeScript, CSS, Vitest, Playwright, GitHub Actions.

**Spec:** Approved conversation scope for PR #30 (`TUX UI alignment fixes`).

## Global Constraints

- Continue on branch `ui/tux-input-alignment-fixes` and PR #30 against `main`.
- Do not apply any Supabase migration remotely.
- Do not add backend/data-model changes for these UI fixes.
- Preserve existing MoneyInput parsing and commit behavior.
- Keep mobile/narrow layouts usable when content overflows.
- Use TDD: failing regression coverage before production changes, then GREEN verification.

---

### Task 1: Canonical MoneyInput styling

**Files:**
- Modify: `apps/operations/src/styles/orders.css`
- Modify: `apps/operations/src/styles/final-pos-corrections.css`
- Test: `apps/operations/src/styles/ui-alignment.test.ts`
- Test: `e2e/operations.e2e.ts`

- [x] Move the inner input border/background/focus contract into `orders.css`.
- [x] Remove dependence on a late `.money-input-wrap` override in `final-pos-corrections.css`.
- [x] Verify Discount, Cash Received, and Expenses Amount render as one composed EGP control.
- [x] Verify wrapper height is at least 44px and focus is shown on the wrapper only.

### Task 2: Overflow-safe Orders Board tabs

**Files:**
- Modify: `apps/operations/src/styles/orders-board.css`
- Test: `apps/operations/src/styles/ui-alignment.test.ts`
- Test: `e2e/operations.e2e.ts`

- [x] Use `justify-content: safe center` so tabs center when they fit and fall back safely when they overflow.
- [x] Remove breakpoint-specific centering dependence.
- [x] Verify desktop centering and 320px first/last-tab reachability in Playwright.

### Task 3: Add/Edit Expenses alignment

**Files:**
- Modify: `apps/operations/src/styles/expenses.css`
- Test: `apps/operations/src/styles/ui-alignment.test.ts`
- Test: `e2e/operations.e2e.ts`

- [x] Keep Add Expense Description, Amount, and Paid From on one desktop visual baseline.
- [x] Expand the desktop Edit Expense dialog enough to inherit the same three-column grid.
- [x] Keep the note field spanning the full row while Description remains in the normal first column.
- [x] Preserve two-column/tablet and one-column/mobile responsive fallbacks.
- [x] Verify Add and Edit control-top alignment in rendered Playwright.

### Task 4: Full verification

- [x] Format check.
- [x] Lint.
- [x] Unit/integration suite.
- [x] Typecheck including E2E.
- [x] Production builds.
- [x] Development provisioning safety smoke.
- [x] Disposable PostgreSQL migration-chain smoke only.
- [x] Edge Function typecheck.
- [x] Full rendered Playwright suite and evidence upload.
- [x] Windows x64 package.
- [x] Required quality gate.

### Task 5: PR audit

- [x] Confirm no Supabase migration files are changed.
- [x] Confirm no temporary verification workflow remains in the PR diff.
- [x] Keep PR #30 open and ready for explicit user merge approval.

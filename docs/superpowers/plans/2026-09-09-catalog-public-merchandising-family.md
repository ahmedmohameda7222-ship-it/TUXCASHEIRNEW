# Catalog Public Merchandising Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing canonical `products.family` through the customer-safe catalog boundary and use it to keep `/tux-burger` and `/tuxify` working against the approved single `Burgers` canonical category.

**Architecture:** Extend the existing V1 public catalog product DTO with nullable `family`, expose `products.family` from the narrow `read_catalog_public_v1` RPC, pass it through `catalog-public`, and preserve it in the Menu projection. Reconcile only the two legacy family routes to `Burgers + TUX/TUXIFY`; all other category routes keep their canonical slug behavior. No production catalog rows, prices, modifiers, combo links, images, or Admin behavior are invented or changed.

**Tech Stack:** TypeScript, React, Vitest, Deno, PostgreSQL/Supabase Edge Functions.

**Spec:** `docs/superpowers/specs/2026-09-07-tux-canonical-catalog-authority-design.md`

## Global Constraints

- Start from `main` commit `dd5a5fdf16f119791d3b50b6b498cf6321faeb35`.
- Preserve UUID database identity and stable public route identity.
- Do not use display-name matching for migration/reconciliation.
- Do not introduce a second catalog authority.
- Do not expose service-role credentials or Operations-only fields to the browser.
- Do not mutate production catalog data as part of this correction.
- Keep the public catalog transport schema at version 1 because this is an additive field produced and consumed atomically by the same cutover boundary.

---

### Task 1: Public transport preserves canonical merchandising family

**Files:**
- Modify: `packages/catalog-contracts/src/index.test.ts`
- Modify: `packages/catalog-contracts/src/index.ts`
- Modify: `supabase/functions/catalog-public/catalog-public.deno.ts`
- Modify: `supabase/functions/catalog-public/catalog.ts`
- Create: `supabase/migrations/20260909193000_catalog_public_merchandising_family.sql`

**Interfaces:**
- Consumes: canonical `products.family text null`.
- Produces: `PublicCatalogProductV1.family: string | null` and matching Edge JSON field `family`.

- [x] **Step 1: Write the failing tests**

Require the contract parser and Edge projection to preserve `family: 'TUX'` / `family: 'TUXIFY'`.

- [x] **Step 2: Run CI to verify RED**

Observed failure: `catalog-public emits deterministic ordering and customer-safe fields only` -> `Error: merchandising family lost`.

- [x] **Step 3: Write minimal implementation**

Add nullable `family` to the public DTO/parser, add `family` to the RPC product JSON, and map that field to `family` in `catalog-public`.

- [ ] **Step 4: Run CI and verify GREEN**

Expected: catalog contract and Deno catalog-public tests pass, migration smoke passes, no unrelated test regression.

### Task 2: Menu keeps family and reconciles legacy family routes

**Files:**
- Modify: `apps/menu/src/context/menuProjection.test.ts`
- Modify: `apps/menu/src/context/menuProjection.ts`
- Create: `apps/menu/src/lib/product-routes.test.ts`
- Modify: `apps/menu/src/lib/product-routes.ts`
- Modify: `apps/menu/src/pages/ProductCategoryPage.tsx`
- Modify: `apps/menu/src/App.tsx`

**Interfaces:**
- Consumes: `PublicCatalogProductV1.family`.
- Produces: `SupabaseProduct.family`, `resolveCanonicalCategoryRoute(routeSlug)`, and family-filtered canonical category pages.

- [x] **Step 1: Write the failing tests**

Require the Menu projection to preserve family and require `tux-burger -> { categorySlug: 'burgers', family: 'TUX' }`, `tuxify -> { categorySlug: 'burgers', family: 'TUXIFY' }`.

- [x] **Step 2: Verify RED**

The Edge RED run failed on the missing family projection before implementation; the route helper did not exist before its RED test commit.

- [x] **Step 3: Write minimal implementation**

Carry `family` into `SupabaseProduct`; add the explicit route reconciliation helper; pass optional family to `ProductCategoryPage`; filter only the selected canonical family for the two legacy routes.

- [ ] **Step 4: Run CI and verify GREEN**

Expected: Menu unit/type/build/rendered E2E checks pass with no visual/layout changes outside product selection.

### Task 3: Review, merge, deploy exact accepted source

**Files:**
- No additional implementation files unless review finds an evidence-backed defect.

**Interfaces:**
- Consumes: GREEN PR head and current `main` authority.
- Produces: merged correction, applied migration, exact Edge redeploy, and reverified production state.

- [ ] **Step 1: Request Codex review on the exact GREEN PR head**

Review only for transport leakage, route correctness, migration safety, and schema compatibility.

- [ ] **Step 2: Verify permanent CI on the exact head**

Require all repository CI jobs to conclude successfully.

- [ ] **Step 3: Merge PR only after review/CI gates**

Use expected head SHA to prevent merging a moved branch.

- [ ] **Step 4: Apply the new migration and redeploy exact merged `catalog-public` source**

Do not touch catalog rows. Re-list migrations/functions and verify `catalog-public` remains `verify_jwt=false`.

- [ ] **Step 5: Resume catalog cutover audit**

Continue resolving explicit production slugs, modifier links, combo beverage authority, and image materialization without inventing business facts.

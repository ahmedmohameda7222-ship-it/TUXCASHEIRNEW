# TUX Production Public Identity Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign stable public slugs to the existing 7 canonical categories and 49 canonical products without changing any approved Supabase business data.

**Architecture:** A committed UUID-keyed manifest is the sole public-identity authority. A small validator fails closed on malformed, duplicate, incomplete, or cross-category bindings. A fenced SQL data migration updates only the two slug columns after proving the target shop has exactly the committed category/product ID sets and no conflicting slug values.

**Tech Stack:** TypeScript 6, Vitest 4, Node.js migration smoke tests, PostgreSQL/Supabase migrations, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-tux-production-public-identity-reconciliation.md`

## Global Constraints

- Supabase production shop `c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46` remains the authority for products, prices, categories, availability, family, combo flags, and UUIDs.
- `TUX-MENU` pinned commit `285635181a9ee1ec2f760feb38abae8fa19a201d` is UX/route reference only.
- No display-name matching or runtime slug generation.
- No product/category create, delete, deactivate, rename, repricing, recategorization, relationship population, or image mutation.
- No production write before PR merge and merged-main CI success.
- Codex is reviewer only, never implementer.

---

### Task 1: Public identity manifest validator

**Files:**
- Create: `scripts/catalog-migration/public-catalog-identity-manifest.json`
- Create: `scripts/catalog-migration/publicIdentity.ts`
- Create: `scripts/catalog-migration/publicIdentity.test.ts`

**Interfaces:**
- Consumes: the exact UUID/slug bindings from the approved spec.
- Produces: `validatePublicIdentityManifest(manifest)` and `assertPublicIdentityInventory(manifest, inventory)`.

- [ ] **Step 1: Write the failing validator tests**

Create tests that require:

```ts
const manifest = loadManifest();
expect(manifest.categoryCount).toBe(7);
expect(manifest.productCount).toBe(49);
expect(() => validatePublicIdentityManifest(manifest)).not.toThrow();
expect(new Set(manifest.categories.map((row) => row.id)).size).toBe(7);
expect(new Set(manifest.products.map((row) => row.id)).size).toBe(49);
```

Also test duplicate slugs, missing rows, invalid UUIDs, invalid slugs, unknown product category IDs, and exact-inventory mismatch. The inventory comparison must use UUID/category-reference sets only and must not consume display names.

- [ ] **Step 2: Run RED verification**

Run through PR CI or locally:

```bash
npx vitest run scripts/catalog-migration/publicIdentity.test.ts
```

Expected: FAIL because `publicIdentity.ts` and/or the committed manifest do not yet exist.

- [ ] **Step 3: Implement the minimal validator and manifest**

Manifest shape:

```ts
interface PublicCatalogIdentityManifest {
  version: 1;
  shopId: string;
  categoryCount: 7;
  productCount: 49;
  categories: Array<{ id: string; slug: string }>;
  products: Array<{ id: string; categoryId: string; slug: string }>;
}
```

Validator rules:

```ts
UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

Require exact declared counts, unique IDs, unique slugs per entity kind, valid category references, and exact UUID-set inventory parity.

- [ ] **Step 4: Run GREEN verification**

```bash
npx vitest run scripts/catalog-migration/publicIdentity.test.ts
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog-migration/public-catalog-identity-manifest.json scripts/catalog-migration/publicIdentity.ts scripts/catalog-migration/publicIdentity.test.ts
git commit -m "feat(catalog): commit canonical public identities"
```

### Task 2: Fenced production slug migration

**Files:**
- Create: `supabase/migrations/20260909213000_catalog_public_identity_reconciliation.sql`
- Create: `scripts/test-catalog-public-identity-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the same committed UUID/slug bindings as Task 1.
- Produces: a one-time data migration that only writes `menu_categories.slug` and `products.slug` for the target shop.

- [ ] **Step 1: Write the failing migration contract test**

The Node test must read the manifest and migration text and assert:

```js
assert.equal(manifest.categories.length, 7);
assert.equal(manifest.products.length, 49);
for (const row of [...manifest.categories, ...manifest.products]) {
  assert.match(sql, new RegExp(row.id.replaceAll('-', '\\-')));
  assert.match(sql, new RegExp(`'${row.slug}'`));
}
```

It must also require hard-fence markers for the shop UUID, exact 7/49 counts, conflicting-slug rejection, post-update verification, and reject update clauses that assign protected business columns (`price_minor`, `name`, `category_id`, `active`, `sold_out`, `family`, `is_combo`, `best_seller`, `image_key`).

- [ ] **Step 2: Run RED verification**

```bash
node scripts/test-catalog-public-identity-migration.mjs
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the SQL migration**

Use explicit `VALUES (uuid, slug)` tables. Before either update:

1. Verify target-shop category count is exactly 7 and product count exactly 49.
2. Verify set equality against every committed category/product UUID.
3. Verify every existing non-null slug is either null or already equal to the intended value.
4. Verify no intended slug collides with another row in the shop.

Then execute only:

```sql
update public.menu_categories as category
set slug = identity.slug
from (...) as identity(id, slug)
where category.shop_id = target_shop_id
  and category.id = identity.id;

update public.products as product
set slug = identity.slug
from (...) as identity(id, slug)
where product.shop_id = target_shop_id
  and product.id = identity.id;
```

Finally verify all 7 + 49 rows match their committed slugs exactly.

- [ ] **Step 4: Wire migration contract test into `npm run test:migrations` and verify GREEN**

```bash
node scripts/test-catalog-public-identity-migration.mjs
npm run test:migrations
npm test
npm run typecheck
npm run format:check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909213000_catalog_public_identity_reconciliation.sql scripts/test-catalog-public-identity-migration.mjs package.json
git commit -m "feat(catalog): reconcile production public slugs"
```

### Task 3: Review and integration gates

**Files:**
- Modify only if verification exposes a real defect.

**Interfaces:**
- Consumes: Tasks 1-2 completed and green.
- Produces: reviewed merge commit ready for production migration.

- [ ] **Step 1: Run full branch verification**

```bash
npm run format:check
npm run lint
npm test
npm run typecheck
npm run build
npm run test:migrations
npm run test:catalog-architecture
npm run test:monorepo-architecture
```

- [ ] **Step 2: Open/update PR from `feat/catalog-public-identity-reconciliation` to `main`**

PR body must state that no product/price/business fields change and list the exact 7/49 scope.

- [ ] **Step 3: Wait for exact-head CI to finish successfully**

No merge on partial or stale CI.

- [ ] **Step 4: Request Codex review on the exact green head**

Address every technically valid finding with its own RED→GREEN cycle. Require clean review signal before merge.

- [ ] **Step 5: Merge with an expected-head SHA fence**

Then verify merged `main` points to the merge commit and wait for merged-main CI success.

### Task 4: Production application and acceptance

**Files:**
- No repository changes unless production verification reveals a repository defect.

**Interfaces:**
- Consumes: merged-main migration `20260909213000_catalog_public_identity_reconciliation.sql`.
- Produces: a public catalog with 7 populated category slugs and 49 populated product slugs.

- [ ] **Step 1: Re-read production inventory before mutation**

Require the exact 7/49 UUID sets and confirm protected business-field counts/values are unchanged from the pre-migration snapshot.

- [ ] **Step 2: Apply the exact merged migration using the Supabase migration tool**

Do not manually run edited SQL or mutate rows outside the migration.

- [ ] **Step 3: Verify migration ledger and data**

Assert:

```text
category slugs populated = 7/7
product slugs populated = 49/49
category count = 7
product count = 49
prices/names/category IDs/family/active/sold_out/is_combo/best_seller/image_key unchanged
```

- [ ] **Step 4: Verify `catalog-public` and Menu routes**

The canonical catalog must no longer fail solely because of missing slugs. Smoke `/`, `/order-now`, `/tux-burger`, `/tuxify`, `/hawawshi`, `/fries`, `/combos`, and `/drinks`.

- [ ] **Step 5: Record remaining business-authority blockers separately**

Do not populate modifiers or combo-beverage relationships in this task. If those remain zero, record that extras/combo ordering remains a separate acceptance blocker rather than inventing relationships from the old Menu.

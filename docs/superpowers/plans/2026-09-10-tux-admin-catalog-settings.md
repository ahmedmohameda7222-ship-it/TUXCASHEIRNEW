# TUX Admin Catalog, Publishing, and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver master-catalog management, per-shop overrides, drafts, atomic publishing, scheduled/recurring configuration, and the shop/order/payment/receipt/reason settings required by Menu and Operations.

**Architecture:** Extend the existing shop-scoped catalog rather than replacing it. Introduce business-level master identities plus draft/version tables, then publish validated projections atomically into the canonical shop tables and existing Operations configuration snapshot authority. Admin writes through trusted BFF commands/RPCs; Menu and Operations consume only published state.

**Tech Stack:** TypeScript, React, TanStack Query, Zod, Supabase/PostgreSQL RPCs, existing `@tux/catalog-contracts`, new `@tux/admin-contracts`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Existing product/category/modifier/combo identities and order history remain valid.
- Important catalog edits use Draft → Preview → Atomic Publish; Sold Out/Available, emergency hide, temporary close, and online-order pause remain immediate operations.
- Old orders preserve historical names/prices/modifiers/recipe/payment/fee values.
- Published Menu and Operations configuration must represent one consistent version.
- Scheduled actions use `Africa/Cairo`; recurring menu/product availability is explicit and server-activated.
- No import/export.

---

### Task 1: Add master catalog, override, draft, version, and schedule schema

**Files:**
- Create: `supabase/migrations/20260910110000_admin_catalog_control.sql`
- Create: `scripts/test-admin-catalog-control-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `catalog_master_products`, `catalog_master_categories`, `catalog_product_shop_overrides`, `catalog_drafts`, `catalog_draft_changes`, `catalog_publish_versions`, `scheduled_config_changes`, `recurring_availability_rules`.
- Produces RPCs: `create_catalog_draft_v1`, `apply_catalog_draft_change_v1`, `publish_catalog_draft_v1`, `set_immediate_product_availability_v1`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const path = 'supabase/migrations/20260910110000_admin_catalog_control.sql';
const sql = fs.readFileSync(path, 'utf8').toLowerCase();
for (const name of ['catalog_master_products','catalog_product_shop_overrides','catalog_drafts','catalog_publish_versions','publish_catalog_draft_v1','recurring_availability_rules']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-catalog-control-migration.mjs
```

Expected: ENOENT before the migration exists.

- [ ] **Step 3: Implement compatible schema and atomic publish RPC**

```sql
create table public.catalog_master_products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  canonical_name text not null,
  description text,
  image_key text,
  archived_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.catalog_product_shop_overrides (
  master_product_id uuid not null references public.catalog_master_products(id),
  shop_id uuid not null references public.shops(id),
  price_minor integer,
  visible boolean,
  manual_sold_out boolean,
  version bigint not null default 1,
  primary key (master_product_id, shop_id)
);
```

`publish_catalog_draft_v1` must lock the draft, validate its `base_publish_version`, validate referenced category/modifier/combo/recipe/shop identities, write the affected canonical shop rows, create one publish-version record, refresh the Operations configuration snapshot inside the same transaction, and mark the draft published only after all writes succeed.

- [ ] **Step 4: Verify migration and existing catalog regression tests**

```bash
node scripts/test-admin-catalog-control-migration.mjs
npm run test:migrations
npm run test:catalog-architecture
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910110000_admin_catalog_control.sql scripts/test-admin-catalog-control-migration.mjs package.json
git commit -m "feat(admin): add catalog control and publish schema"
```

### Task 2: Add Admin catalog contracts and BFF commands

**Files:**
- Create: `packages/admin-contracts/src/catalog.ts`
- Modify: `packages/admin-contracts/src/index.ts`
- Create: `apps/admin/server/catalog/catalogService.ts`
- Create: `apps/admin/api/admin/catalog.ts`
- Test: `apps/admin/server/catalog/catalogService.test.ts`

**Interfaces:**
- Produces: `CatalogDraftSummary`, `CatalogProductDetail`, `CatalogPublishPreview`, `saveCatalogDraftChange`, `publishCatalogDraft`, `setImmediateAvailability`.

- [ ] **Step 1: Write a failing atomic-publish service test**

```ts
it('returns stale_version without calling publish when the base version changed', async () => {
  const result = await service.publishCatalogDraft({ draftId: 'd1', expectedVersion: 48 }, principal);
  expect(result).toEqual({ ok: false, code: 'stale_version', message: expect.any(String), currentVersion: 49 });
  expect(rpc.publishCatalogDraft).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/catalog/catalogService.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 3: Implement typed catalog command dispatch**

```ts
export type CatalogCommand =
  | { type: 'draft.save'; draftId: string; expectedVersion: number; changes: CatalogDraftChange[] }
  | { type: 'draft.publish'; draftId: string; expectedVersion: number }
  | { type: 'availability.set'; shopId: string; productId: string; soldOut: boolean };
```

Require `catalog.edit` for draft saves, `catalog.publish` for publish, and `catalog.pricing` when draft changes include price fields. Require explicit shop authorization for immediate availability changes.

- [ ] **Step 4: Verify service tests/typecheck**

```bash
npx vitest run apps/admin/server/catalog/catalogService.test.ts
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src apps/admin/server/catalog apps/admin/api/admin/catalog.ts
git commit -m "feat(admin): add trusted catalog commands"
```

### Task 3: Build Catalog management UI

**Files:**
- Create: `apps/admin/src/catalog/CatalogPage.tsx`
- Create: `apps/admin/src/catalog/ProductList.tsx`
- Create: `apps/admin/src/catalog/ProductEditor.tsx`
- Create: `apps/admin/src/catalog/ProductInspector.tsx`
- Create: `apps/admin/src/catalog/AvailabilityStatus.tsx`
- Create: `apps/admin/src/catalog/useCatalog.ts`
- Test: `apps/admin/src/catalog/ProductEditor.test.tsx`
- E2E: `e2e/admin-catalog.spec.ts`

**Interfaces:**
- Consumes BFF catalog endpoints.
- Produces phone list/full-screen edit, tablet split view, desktop list/inspector behavior.

- [ ] **Step 1: Write failing product-editor tests**

```tsx
it('keeps advanced fields behind progressive disclosure', () => {
  render(<ProductEditor product={fixtureProduct} />);
  expect(screen.getByLabelText('Price')).toBeTruthy();
  expect(screen.queryByText('Recipe / Inventory')).toBeNull();
  fireEvent.click(screen.getByText('More'));
  expect(screen.getByText('Recipe / Inventory')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/catalog/ProductEditor.test.tsx
```

Expected: fail because editor does not exist.

- [ ] **Step 3: Implement catalog screens and draft state**

`ProductEditor` must expose General, Pricing, Availability, Images, Extras/Modifiers, Combo Options, Recipe/Inventory, Shop Overrides, History. A normal edit saves a draft; immediate Sold Out uses the immediate endpoint and displays `This change goes live immediately.`

- [ ] **Step 4: Verify responsive E2E and unit tests**

```bash
npx vitest run apps/admin/src/catalog/ProductEditor.test.tsx
npx playwright test e2e/admin-catalog.spec.ts
```

Expected: phone, tablet, and desktop cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/catalog e2e/admin-catalog.spec.ts
git commit -m "feat(admin): add catalog management UI"
```

### Task 4: Add Preview, Publish, rollback, scheduled, and recurring configuration

**Files:**
- Create: `apps/admin/src/catalog/PublishReviewPage.tsx`
- Create: `apps/admin/src/catalog/VersionHistory.tsx`
- Create: `apps/admin/src/catalog/ScheduleEditor.tsx`
- Create: `apps/admin/server/catalog/scheduler.ts`
- Create: `apps/admin/api/cron/admin-config-scheduler.ts`
- Test: `apps/admin/server/catalog/scheduler.test.ts`
- E2E: `e2e/admin-catalog-publish.spec.ts`

**Interfaces:**
- Produces preview diff, atomic publish, restore-as-new-version, one-time scheduled activation, recurring availability rules.

- [ ] **Step 1: Write failing scheduler tests**

```ts
it('activates only due Cairo schedules exactly once', async () => {
  clock.setSystemTime(new Date('2026-09-11T05:00:00Z')); // 08:00 Cairo
  await runCatalogScheduler(deps);
  expect(deps.publish).toHaveBeenCalledTimes(1);
  await runCatalogScheduler(deps);
  expect(deps.publish).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/catalog/scheduler.test.ts
```

Expected: fail because scheduler is absent.

- [ ] **Step 3: Implement version-safe scheduler and rollback-as-new-version**

Scheduled records must be validated when created, retain intended `Africa/Cairo` local schedule semantics, and execute with an idempotency key. Rollback must read a prior snapshot and publish its content as a new version rather than deleting or rewriting history.

- [ ] **Step 4: Run catalog publish regression gate**

```bash
npx vitest run apps/admin/server/catalog/scheduler.test.ts
npx playwright test e2e/admin-catalog-publish.spec.ts
npm run test:catalog-architecture
npm run test:migrations
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/catalog apps/admin/server/catalog apps/admin/api/cron e2e/admin-catalog-publish.spec.ts
git commit -m "feat(admin): add catalog publishing schedules and history"
```

### Task 5: Add Shops, Order Types, Payments, Checkout, Receipts, and Reason Codes

**Files:**
- Create: `supabase/migrations/20260910120000_admin_shop_settings.sql`
- Create: `packages/admin-contracts/src/settings.ts`
- Create: `apps/admin/server/settings/settingsService.ts`
- Create: `apps/admin/api/admin/settings.ts`
- Create: `apps/admin/src/settings/SettingsPage.tsx`
- Create: `apps/admin/src/settings/ShopsPage.tsx`
- Create: `apps/admin/src/settings/OrderTypesPage.tsx`
- Create: `apps/admin/src/settings/PaymentsPage.tsx`
- Create: `apps/admin/src/settings/CheckoutPage.tsx`
- Create: `apps/admin/src/settings/ReceiptsPage.tsx`
- Create: `apps/admin/src/settings/ReasonCodesPage.tsx`
- Test: `apps/admin/server/settings/settingsService.test.ts`
- E2E: `e2e/admin-settings.spec.ts`

**Interfaces:**
- Produces global defaults + shop overrides for payment methods, order types, checkout rules, receipt/order numbering, canonical shop contact/location, and structured reason codes.

- [ ] **Step 1: Write failing inheritance tests**

```ts
it('resolves shop override before business default', async () => {
  const value = await service.resolveSetting('serviceChargeBps', { businessId: 'b1', shopId: 's1' });
  expect(value).toEqual({ source: 'shop', value: 700 });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/settings/settingsService.test.ts
```

Expected: fail because settings service is absent.

- [ ] **Step 3: Implement canonical setting authority**

The migration must add business defaults and shop overrides without duplicating existing `order_types`, `payment_methods`, or `delivery_zones`. Canonical shop name/address/phone/coordinates must be referenced by Menu, receipts, delivery, and WhatsApp store-location rendering. Reason codes must support cancellation, refund/return, discount/comp, waste, stock adjustment, cash variance, pay-in, and pay-out categories.

- [ ] **Step 4: Verify settings integration**

```bash
npx vitest run apps/admin/server/settings/settingsService.test.ts
npx playwright test e2e/admin-settings.spec.ts
npm run test:migrations
npm run test:catalog-architecture
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910120000_admin_shop_settings.sql packages/admin-contracts/src/settings.ts apps/admin/server/settings apps/admin/api/admin/settings.ts apps/admin/src/settings e2e/admin-settings.spec.ts
git commit -m "feat(admin): add shop and checkout settings management"
```

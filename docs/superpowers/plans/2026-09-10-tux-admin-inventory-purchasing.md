# TUX Admin Inventory and Purchasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the current inventory foundation into a trustworthy stock ledger, recipe/cost engine, stocktake/transfer/waste workflow, par/reorder intelligence, and complete supplier/purchasing/receiving flow.

**Architecture:** Preserve `inventory_items` and `recipe_lines`, then add ledger/reservation/cost projections around them. All stock-affecting commands execute through transactional RPCs and create immutable movements; current quantity is a projection, not manually rewritten history. Purchasing feeds weighted-average cost and inventory value without immediately becoming COGS.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, React/TanStack Query, Vitest, migration tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Tracking supports ingredients/recipes and direct-stock packaged items.
- Base units are canonical; purchase-unit conversions are configured per inventory item.
- `On Hand - Reserved = Available`; negative available stock is blocked by default.
- ACTIVE accepted orders reserve; DONE consumes; CANCELLED releases; RETURNED never automatically restores consumed food stock.
- Weighted-average cost is shop-specific and historical order cost basis remains stable.
- Transfers preserve source cost and require send/receive state transitions.
- Stocktake posts auditable adjustment movements against a consistent snapshot.
- No lot/batch/expiry/bin warehouse system.

---

### Task 1: Add inventory ledger, reservations, units, costing, stocktake, and transfer schema

**Files:**
- Create: `supabase/migrations/20260910130000_admin_inventory_ledger.sql`
- Create: `scripts/test-admin-inventory-ledger-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `inventory_unit_conversions`, `inventory_movements`, `inventory_reservations`, `inventory_cost_state`, `stocktakes`, `stocktake_lines`, `stock_transfers`, `stock_transfer_lines`.
- Produces RPCs: `reserve_inventory_for_order_v1`, `consume_inventory_for_order_v1`, `release_inventory_for_order_v1`, `post_inventory_adjustment_v1`, `post_stocktake_v1`, `send_stock_transfer_v1`, `receive_stock_transfer_v1`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910130000_admin_inventory_ledger.sql', 'utf8').toLowerCase();
for (const name of ['inventory_movements','inventory_reservations','inventory_cost_state','stocktakes','stock_transfers','reserve_inventory_for_order_v1']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-inventory-ledger-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement ledger-first schema and transactional RPCs**

```sql
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  movement_type text not null check (movement_type in ('OPENING','RECEIVING','RESERVE','RELEASE','CONSUME','WASTE','ADJUSTMENT','TRANSFER_OUT','TRANSFER_IN','STOCKTAKE','PURCHASE_RETURN')),
  quantity_base numeric not null,
  unit_cost_minor numeric,
  source_type text not null,
  source_id uuid,
  command_id uuid not null,
  actor_employee_id uuid references public.business_employees(id),
  reason_code text,
  created_at timestamptz not null default now(),
  unique (shop_id, command_id, inventory_item_id, movement_type)
);
```

Each RPC must lock affected inventory state rows, enforce shop identity, write movements, update the current projection/cost state, and return one deterministic result for repeated `command_id` values.

- [ ] **Step 4: Verify migration and existing order/migration suites**

```bash
node scripts/test-admin-inventory-ledger-migration.mjs
npm run test:migrations
npm test
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910130000_admin_inventory_ledger.sql scripts/test-admin-inventory-ledger-migration.mjs package.json
git commit -m "feat(admin): add inventory ledger and reservation model"
```

### Task 2: Add recipe costing and order inventory lifecycle integration

**Files:**
- Create: `packages/admin-contracts/src/inventory.ts`
- Create: `apps/admin/server/inventory/inventoryService.ts`
- Create: `apps/admin/server/inventory/costing.ts`
- Modify: `supabase/functions/online-order-operations/index.ts`
- Modify: Operations order-completion/cancellation server path discovered during execution
- Test: `apps/admin/server/inventory/costing.test.ts`
- Test: `scripts/test-admin-order-inventory-lifecycle.mjs`

**Interfaces:**
- Produces: `InventoryBalance`, `RecipeCost`, `calculateWeightedAverageCost`, `calculateRecipeCost`.

- [ ] **Step 1: Write failing cost/lifecycle tests**

```ts
it('calculates weighted average cost', () => {
  expect(calculateWeightedAverageCost({ quantity: 10_000, unitCostMinor: 20 }, { quantity: 10_000, unitCostMinor: 24 })).toBe(22);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/inventory/costing.test.ts
node scripts/test-admin-order-inventory-lifecycle.mjs
```

Expected: failure until costing/lifecycle integration exists.

- [ ] **Step 3: Implement costing and lifecycle hooks**

```ts
export function calculateWeightedAverageCost(
  current: { quantity: number; unitCostMinor: number },
  receipt: { quantity: number; unitCostMinor: number },
): number {
  const total = current.quantity + receipt.quantity;
  if (total === 0) return 0;
  return (current.quantity * current.unitCostMinor + receipt.quantity * receipt.unitCostMinor) / total;
}
```

Accepted POS/canonical ONLINE orders must call reservation exactly once; DONE posts consumption and releases reservation atomically; CANCELLED releases; RETURNED records financial reversal without inventory restoration.

- [ ] **Step 4: Verify order/inventory regression tests**

```bash
npx vitest run apps/admin/server/inventory/costing.test.ts
node scripts/test-admin-order-inventory-lifecycle.mjs
npm run test:migrations
npm test
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/inventory.ts apps/admin/server/inventory supabase/functions/online-order-operations scripts/test-admin-order-inventory-lifecycle.mjs
git commit -m "feat(inventory): connect orders to stock reservation and costing"
```

### Task 3: Build Inventory, Waste, Stocktake, and Transfer UI

**Files:**
- Create: `apps/admin/api/admin/inventory.ts`
- Create: `apps/admin/src/inventory/InventoryPage.tsx`
- Create: `apps/admin/src/inventory/InventoryItemPage.tsx`
- Create: `apps/admin/src/inventory/AdjustStockSheet.tsx`
- Create: `apps/admin/src/inventory/RecordWasteSheet.tsx`
- Create: `apps/admin/src/inventory/StocktakePage.tsx`
- Create: `apps/admin/src/inventory/TransferPage.tsx`
- Create: `apps/admin/src/inventory/useInventory.ts`
- Test: `apps/admin/src/inventory/InventoryItemPage.test.tsx`
- E2E: `e2e/admin-inventory.spec.ts`

**Interfaces:**
- Produces mobile-first inventory management using ledger commands only.

- [ ] **Step 1: Write failing UI behavior test**

```tsx
it('shows on-hand, reserved and available separately', () => {
  render(<InventoryItemPage item={{ ...fixture, onHand: 3200, reserved: 1100, available: 2100 }} />);
  expect(screen.getByText('3.2 kg')).toBeTruthy();
  expect(screen.getByText('1.1 kg')).toBeTruthy();
  expect(screen.getByText('2.1 kg')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/inventory/InventoryItemPage.test.tsx
```

Expected: fail because page does not exist.

- [ ] **Step 3: Implement mobile-first inventory actions**

Use focused flows for Receive, Adjust, Transfer, Waste, Stock Count, and History. Adjustment and waste require structured reason codes. Stocktake must display snapshot quantity, actual count, quantity/value variance, recount state, and approval requirement without editing historical movements.

- [ ] **Step 4: Verify UI/E2E**

```bash
npx vitest run apps/admin/src/inventory/InventoryItemPage.test.tsx
npx playwright test e2e/admin-inventory.spec.ts
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/api/admin/inventory.ts apps/admin/src/inventory e2e/admin-inventory.spec.ts
git commit -m "feat(admin): add inventory management workflows"
```

### Task 4: Add par levels, reorder suggestions, actual-vs-theoretical, and margin alerts

**Files:**
- Create: `supabase/migrations/20260910140000_admin_inventory_intelligence.sql`
- Create: `apps/admin/server/inventory/intelligence.ts`
- Create: `apps/admin/src/inventory/ReorderSuggestionsPage.tsx`
- Create: `apps/admin/src/inventory/VarianceReport.tsx`
- Test: `apps/admin/server/inventory/intelligence.test.ts`

**Interfaces:**
- Produces `suggestOrderQuantity(available, parLevel, incoming)`, actual/theoretical variance, and food-cost margin alerts.

- [ ] **Step 1: Write failing intelligence tests**

```ts
it('subtracts incoming stock from reorder suggestion', () => {
  expect(suggestOrderQuantity({ available: 6000, par: 15000, incoming: 2000 })).toBe(7000);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/inventory/intelligence.test.ts
```

Expected: fail before implementation.

- [ ] **Step 3: Implement deterministic calculations**

```ts
export const suggestOrderQuantity = ({ available, par, incoming }: { available: number; par: number; incoming: number }) =>
  Math.max(0, par - available - incoming);
```

Actual usage is stocktake/ledger-derived usage for the period; theoretical usage is completed-order recipe consumption for the same period. Margin alerts compare current recipe cost percentage against configured target/threshold and identify the largest ingredient-cost contributors.

- [ ] **Step 4: Verify calculations and migration suite**

```bash
npx vitest run apps/admin/server/inventory/intelligence.test.ts
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910140000_admin_inventory_intelligence.sql apps/admin/server/inventory/intelligence.ts apps/admin/src/inventory
git commit -m "feat(admin): add inventory intelligence and margin alerts"
```

### Task 5: Add suppliers, purchase orders, receiving, partial receiving, and purchase returns

**Files:**
- Create: `supabase/migrations/20260910150000_admin_purchasing.sql`
- Create: `packages/admin-contracts/src/purchasing.ts`
- Create: `apps/admin/server/purchasing/purchasingService.ts`
- Create: `apps/admin/api/admin/purchasing.ts`
- Create: `apps/admin/src/purchasing/SuppliersPage.tsx`
- Create: `apps/admin/src/purchasing/PurchaseOrdersPage.tsx`
- Create: `apps/admin/src/purchasing/PurchaseOrderPage.tsx`
- Create: `apps/admin/src/purchasing/ReceivePurchasePage.tsx`
- Test: `apps/admin/server/purchasing/purchasingService.test.ts`
- E2E: `e2e/admin-purchasing.spec.ts`

**Interfaces:**
- Produces `DRAFT | ORDERED | PARTIALLY_RECEIVED | RECEIVED | CANCELLED` PO lifecycle and transactional receiving into inventory/cost state.

- [ ] **Step 1: Write failing partial-receipt test**

```ts
it('marks a partially received PO without pretending the remainder arrived', async () => {
  const result = await service.receive({ poId: 'po1', lines: [{ lineId: 'l1', receivedBase: 9500 }] }, principal);
  expect(result.value.status).toBe('PARTIALLY_RECEIVED');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/purchasing/purchasingService.test.ts
```

Expected: fail before purchasing service exists.

- [ ] **Step 3: Implement supplier/PO/receiving transactions**

Receiving must create a receiving record, inventory movement, weighted-average-cost update, PO received quantity/status update, supplier-price history entry, and audit event in one transaction. Purchase returns create negative receiving-equivalent movements linked to supplier/PO/reference; transfers are never represented as purchases.

- [ ] **Step 4: Verify purchasing and inventory integration**

```bash
npx vitest run apps/admin/server/purchasing/purchasingService.test.ts
npx playwright test e2e/admin-purchasing.spec.ts
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910150000_admin_purchasing.sql packages/admin-contracts/src/purchasing.ts apps/admin/server/purchasing apps/admin/api/admin/purchasing.ts apps/admin/src/purchasing e2e/admin-purchasing.spec.ts
git commit -m "feat(admin): add supplier purchasing and receiving"
```

# TUX Admin Inventory and Purchasing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the current inventory foundation into a trustworthy stock ledger, recipe/cost engine, stocktake/transfer/waste workflow, par/reorder intelligence, and complete supplier/purchasing/receiving flow.

**Architecture:** Preserve `inventory_items`, `recipe_lines`, and the existing `inventory_movements` ledger, then extend the current ledger additively and add reservation/cost projections around it. All stock-affecting commands execute through transactional RPCs and create immutable movements; current quantity is a projection, not manually rewritten history. Purchasing feeds weighted-average cost and inventory value without immediately becoming COGS.

**Tech Stack:** PostgreSQL/Supabase RPCs, TypeScript Admin BFF, React/TanStack Query, Vitest, migration tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Tracking supports ingredients/recipes and direct-stock packaged items.
- Base units are canonical; purchase-unit conversions are configured per inventory item.
- `On Hand - Reserved = Available`; negative available stock is blocked by default.
- ACTIVE accepted orders reserve; DONE consumes; CANCELLED releases; RETURNED never automatically restores consumed food stock.
- Existing Operations currently posts `ORDER_CONSUMPTION` during `OperationsOrdersService.placeOrder`; this plan deliberately migrates that behavior to reservation-at-ACTIVE and consumption-at-DONE while preserving idempotency and existing order history.
- Existing Operations `undoDone` remains supported: undoing DONE back to ACTIVE must reverse the new consumption event and restore the reservation atomically rather than creating free stock.
- The existing `public.inventory_movements` table is authoritative history. Never recreate, drop, rename, truncate, or rewrite it; preserve all existing rows, legacy columns, legacy movement types, tenant constraints, indexes, idempotency behavior, and Operations/sync compatibility while extending it additively.
- Weighted-average cost is shop-specific and historical order cost basis remains stable.
- Transfers preserve source cost and require send/receive state transitions.
- Stocktake posts auditable adjustment movements against a consistent snapshot.
- No lot/batch/expiry/bin warehouse system.

---

### Task 1: Extend inventory ledger and add reservations, units, costing, stocktake, and transfer schema

**Files:**
- Create: `supabase/migrations/20260910130000_admin_inventory_ledger.sql`
- Create: `scripts/test-admin-inventory-ledger-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Extends existing table: `inventory_movements`.
- Produces tables: `inventory_unit_conversions`, `inventory_reservations`, `inventory_cost_state`, `stocktakes`, `stocktake_lines`, `stock_transfers`, `stock_transfer_lines`.
- Produces RPCs: `reserve_inventory_for_order_v1`, `consume_inventory_for_order_v1`, `restore_order_reservation_v1`, `release_inventory_for_order_v1`, `post_inventory_adjustment_v1`, `post_stocktake_v1`, `send_stock_transfer_v1`, `receive_stock_transfer_v1`.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910130000_admin_inventory_ledger.sql', 'utf8').toLowerCase();
for (const name of ['inventory_movements','inventory_reservations','inventory_cost_state','stocktakes','stock_transfers','reserve_inventory_for_order_v1']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
if (/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.inventory_movements\b/.test(sql)) {
  throw new Error('existing inventory_movements must be extended, not recreated');
}
for (const legacy of [
  'order_consumption',
  'cancel_restock',
  'bulk_unit_finished',
  'bulk_stock_received',
  'undo_bulk_unit_finished',
  'undo_bulk_stock_received',
  'admin_adjustment',
]) {
  if (!sql.includes(legacy)) throw new Error(`legacy movement type must remain valid: ${legacy}`);
}
if (!sql.includes('alter table public.inventory_movements')) {
  throw new Error('migration must alter the existing inventory ledger additively');
}
```

Extend the executable migration-chain test to seed at least one legacy `inventory_movements` row before this migration, apply the migration, and prove that the row, its identifiers, quantity, worker/order linkage, and legacy `movement_type` survive unchanged. The same test must prove the new movement types/RPCs work without changing the canonical shop or breaking existing Operations reads.

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-inventory-ledger-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Extend the existing ledger in place and implement transactional RPCs**

Do **not** create a second `inventory_movements` table and do not replace the existing table definition. Inspect the live repository schema first. The current ledger already contains `shop_id`, `business_day_id`, `inventory_item_id`, legacy `movement_type`, `quantity_delta_micros`, `worker_id`, `order_id`, `compensates_movement_id`, `idempotency_key`, and `created_at`. Evolve that table with additive/compatible metadata needed by Admin inventory commands, such as nullable Admin actor/cost/source/command metadata, while retaining the canonical quantity-delta representation and all historical rows.

If the existing movement-type CHECK must be widened, replace only that constraint with a superset that includes **all** legacy values plus the new reservation/consumption/receiving/waste/transfer/stocktake/purchase-return values. Never rewrite old rows to new labels. If actor nullability or a new actor discriminator is required for Admin-origin movements, prove with regression tests that Operations-created movements keep their existing worker semantics and that the Operations sync/parser remains compatible. Prefer additive actor/source columns and compatibility checks over repurposing legacy columns.

Each RPC must lock affected inventory state rows, enforce shop identity, write immutable movements into the existing ledger, update the current projection/cost state, and return one deterministic result for repeated command/idempotency values. Reservation rows may represent held stock, but historical movement rows are never deleted to represent state changes.

- [ ] **Step 4: Verify migration and existing order/migration suites**

```bash
node scripts/test-admin-inventory-ledger-migration.mjs
npm run test:migrations
npm test
```

Expected: exit `0`; legacy inventory rows/types remain valid and byte-for-byte business history is preserved, new ledger capabilities work, and existing Operations/order/sync tests remain green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910130000_admin_inventory_ledger.sql scripts/test-admin-inventory-ledger-migration.mjs package.json
git commit -m "feat(admin): extend inventory ledger and add reservation model"
```

### Task 2: Add recipe costing and migrate the existing Operations order inventory lifecycle

**Files:**
- Create: `packages/admin-contracts/src/inventory.ts`
- Create: `apps/admin/server/inventory/inventoryService.ts`
- Create: `apps/admin/server/inventory/costing.ts`
- Modify: `packages/application/src/orders.ts`
- Modify: `packages/application/src/orders.test.ts`
- Modify: `packages/application/src/ordersBoard.ts`
- Modify: `packages/application/src/ordersBoard.test.ts`
- Modify: `packages/application/src/onlineOrderAcceptance.test.ts`
- Modify: `supabase/functions/online-order-operations/index.ts` only if its persistence adapter needs the new reservation RPC/fields; do not duplicate lifecycle logic there.
- Test: `apps/admin/server/inventory/costing.test.ts`
- Create: `scripts/test-admin-order-inventory-lifecycle.mjs`

**Existing integration points:**
- `packages/application/src/orders.ts`: `OperationsOrdersService.placeOrder()` currently calculates recipe usage and appends `ORDER_CONSUMPTION` movements inside the order commit. Replace that side effect with one reservation per required inventory item when the order becomes ACTIVE.
- `packages/application/src/ordersBoard.ts`: `OperationsOrdersBoardService.markDone()`, `undoDone()`, `cancelOrder()`, and `returnDelivery()` are the canonical Operations lifecycle transitions. `markDone()` must convert reservation to consumption; `undoDone()` must reverse consumption and recreate the reservation; `cancelOrder()` must release reservation rather than compensating placement-time consumption; `returnDelivery()` must keep inventory consumed.
- `packages/application/src/onlineOrderAcceptance.ts`: `OperationsOnlineOrderAcceptanceService.accept()` delegates accepted ONLINE orders to `OperationsOrdersService.placeOrder()`, so it inherits the same reservation semantics and must not create a second reservation path.

**Interfaces:**
- Produces: `InventoryBalance`, `RecipeCost`, `calculateWeightedAverageCost`, `calculateRecipeCost`.

- [ ] **Step 1: Write failing cost/lifecycle tests**

```ts
it('calculates weighted average cost', () => {
  expect(calculateWeightedAverageCost({ quantity: 10_000, unitCostMinor: 20 }, { quantity: 10_000, unitCostMinor: 24 })).toBe(22);
});
```

Add application tests that prove an ACTIVE order creates reservation only, `markDone()` consumes exactly once, `undoDone()` returns the order to reserved ACTIVE stock, cancellation releases reservation, returned delivery does not restore stock, and accepted ONLINE orders reuse the same placement reservation path.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/inventory/costing.test.ts packages/application/src/orders.test.ts packages/application/src/ordersBoard.test.ts packages/application/src/onlineOrderAcceptance.test.ts
node scripts/test-admin-order-inventory-lifecycle.mjs
```

Expected: new lifecycle assertions fail because current `placeOrder()` consumes immediately.

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

In `OperationsOrdersService.placeOrder()`, retain recipe-consumption calculation but persist reservation intent/movements instead of decrementing on-hand as consumed. In `OperationsOrdersBoardService.markDone()`, consume the exact reservation atomically with the status transition and outbox/audit event. In `undoDone()`, append a compensating consumption-reversal movement and restore the reservation atomically. In `cancelOrder()`, release the existing reservation regardless of `foodPrepared`; if food preparation itself must be represented as waste/consumption, that is an explicit separate movement, not an implicit cancellation hack. `returnDelivery()` records the financial return while leaving consumed inventory unchanged.

- [ ] **Step 4: Verify order/inventory regression tests**

```bash
npx vitest run apps/admin/server/inventory/costing.test.ts packages/application/src/orders.test.ts packages/application/src/ordersBoard.test.ts packages/application/src/onlineOrderAcceptance.test.ts
node scripts/test-admin-order-inventory-lifecycle.mjs
npm run test:migrations
npm test
```

Expected: ACTIVE/reserve, DONE/consume, undo-DONE/re-reserve, CANCELLED/release, RETURNED/no-restore, and ONLINE acceptance assertions all pass; existing Operations order tests remain green.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/inventory.ts apps/admin/server/inventory packages/application/src/orders.ts packages/application/src/orders.test.ts packages/application/src/ordersBoard.ts packages/application/src/ordersBoard.test.ts packages/application/src/onlineOrderAcceptance.test.ts supabase/functions/online-order-operations/index.ts scripts/test-admin-order-inventory-lifecycle.mjs
git commit -m "feat(inventory): migrate orders to reserve then consume stock"
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
import fs from 'node:fs';

const models = fs.readFileSync('packages/domain/src/models.ts', 'utf8');
const board = fs.readFileSync('packages/application/src/ordersBoard.ts', 'utf8');
const materializer = fs.readFileSync('packages/sync/src/remoteMaterializer.ts', 'utf8');

if (!models.includes('unitCostMinor')) {
  throw new Error('InventoryMovement must carry an immutable unit-cost snapshot when applicable');
}
if (!/ORDER_CONSUMPTION[\s\S]{0,1200}unitCostMinor/.test(board)) {
  throw new Error('DONE consumption must snapshot the current weighted inventory cost');
}
if (!materializer.includes('unit_cost_minor: movement.unitCostMinor ?? null')) {
  throw new Error('Operations sync must persist immutable movement unit-cost snapshots remotely');
}

console.log('Inventory historical cost snapshot invariant passed.');

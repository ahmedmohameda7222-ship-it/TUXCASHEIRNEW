import fs from 'node:fs';
import { existsSync } from 'node:fs';

const models = fs.readFileSync('packages/domain/src/models.ts', 'utf8');
const orders = fs.readFileSync('packages/application/src/orders.ts', 'utf8');
const board = fs.readFileSync('packages/application/src/ordersBoard.ts', 'utf8');
const sqliteMigrations = fs.readFileSync('packages/persistence/src/sqlite/migrations.ts', 'utf8');
const sqliteDatabase = fs.readFileSync(
  'packages/persistence/src/sqlite/SqliteOperationsDatabase.ts',
  'utf8',
);
const remoteMaterializer = fs.readFileSync('packages/sync/src/remoteMaterializer.ts', 'utf8');

for (const movementType of [
  'ORDER_RESERVATION',
  'ORDER_RESERVATION_RELEASE',
  'ORDER_CONSUMPTION',
  'ORDER_CONSUMPTION_REVERSAL',
]) {
  if (!models.includes(`'${movementType}'`)) {
    throw new Error(`domain InventoryMovementType missing ${movementType}`);
  }
}

if (!models.includes('reservedDeltaMicros')) {
  throw new Error('InventoryMovement must model reservedDeltaMicros separately from on-hand delta');
}

if (!/movementType:\s*'ORDER_RESERVATION'/.test(orders)) {
  throw new Error('order placement must create ORDER_RESERVATION movements');
}
if (/movementType:\s*'ORDER_CONSUMPTION'/.test(orders)) {
  throw new Error('order placement must not consume stock immediately');
}

if (!/markDone[\s\S]*ORDER_CONSUMPTION/.test(board)) {
  throw new Error('markDone must convert reservation to consumption');
}
if (!/undoDone[\s\S]*ORDER_CONSUMPTION_REVERSAL/.test(board)) {
  throw new Error('undoDone must reverse consumption and restore reservation');
}
if (!/cancelOrder[\s\S]*ORDER_RESERVATION_RELEASE/.test(board)) {
  throw new Error('cancelOrder must release reservation');
}
if (
  !board.includes(
    'Compatibility for ACTIVE orders created before reservation-at-placement was introduced.',
  )
) {
  throw new Error(
    'cancelOrder must preserve an explicit legacy pre-reservation compatibility path',
  );
}

if (!sqliteMigrations.includes('reserved_delta_micros')) {
  throw new Error('SQLite inventory ledger must persist reserved_delta_micros');
}
if (!sqliteMigrations.includes('quantity_delta_micros <> 0 OR reserved_delta_micros <> 0')) {
  throw new Error('SQLite inventory effect constraint must allow reservation-only movements');
}
if (!sqliteDatabase.includes('movement.reservedDeltaMicros ?? 0')) {
  throw new Error(
    'SQLite movement writes must persist reservedDeltaMicros with legacy zero fallback',
  );
}
if (!remoteMaterializer.includes('reserved_delta_micros: movement.reservedDeltaMicros ?? 0')) {
  throw new Error('remote materializer must propagate reservation delta to PostgreSQL');
}


for (const requiredPath of [
  'packages/sync/src/inventoryConvergence.ts',
  'supabase/functions/operations-inventory/index.ts',
  'apps/operations/api/operations-inventory.ts',
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Admin-origin inventory convergence missing required path: ${requiredPath}`);
  }
}

const convergence = fs.readFileSync('packages/sync/src/inventoryConvergence.ts', 'utf8');
const browserAutomaticSync = fs.readFileSync('apps/operations/src/app/automaticSync.ts', 'utf8');
const desktopAutomaticSync = fs.readFileSync('apps/operations-desktop/src/main/automaticSync.ts', 'utf8');
const indexedDb = fs.readFileSync(
  'packages/persistence/src/browser/IndexedDbOperationsDatabase.ts',
  'utf8',
);

if (!models.includes('workerId: WorkerId | null')) {
  throw new Error('canonical Admin inventory movements must not be forged as worker-originated');
}
if (!sqliteMigrations.includes('inventory_sync_cursors')) {
  throw new Error('SQLite must persist a durable monotonic inventory sync cursor');
}
if (!indexedDb.includes('inventorySyncCursor')) {
  throw new Error('IndexedDB must persist a durable monotonic inventory sync cursor');
}
if (!convergence.includes('InventoryConvergenceService')) {
  throw new Error('Operations needs an inbound inventory convergence service');
}
if (!browserAutomaticSync.includes('InventoryConvergenceService')) {
  throw new Error('browser Operations automatic sync must pull canonical inventory changes');
}
if (!desktopAutomaticSync.includes('InventoryConvergenceService')) {
  throw new Error('desktop Operations automatic sync must pull canonical inventory changes');
}

console.log('Admin order inventory lifecycle source invariants passed.');

import fs from 'node:fs';

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
if (/cancelOrder[\s\S]*CANCEL_RESTOCK/.test(board)) {
  throw new Error('cancelOrder must not use legacy cancellation restock for new reservations');
}

if (!sqliteMigrations.includes('reserved_delta_micros')) {
  throw new Error('SQLite inventory ledger must persist reserved_delta_micros');
}
if (!sqliteMigrations.includes('quantity_delta_micros <> 0 OR reserved_delta_micros <> 0')) {
  throw new Error('SQLite inventory effect constraint must allow reservation-only movements');
}
if (!sqliteDatabase.includes('movement.reservedDeltaMicros ?? 0')) {
  throw new Error('SQLite movement writes must persist reservedDeltaMicros with legacy zero fallback');
}
if (!remoteMaterializer.includes('reserved_delta_micros: movement.reservedDeltaMicros ?? 0')) {
  throw new Error('remote materializer must propagate reservation delta to PostgreSQL');
}

console.log('Admin order inventory lifecycle source invariants passed.');

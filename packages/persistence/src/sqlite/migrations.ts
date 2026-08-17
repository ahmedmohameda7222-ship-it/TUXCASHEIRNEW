import type { DatabaseSync } from 'node:sqlite';

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: 'operations_foundation',
    sql: `
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  label TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_devices_shop ON devices(shop_id, active);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_workers_shop ON workers(shop_id);

CREATE TABLE business_days (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  started_by_worker_id TEXT NOT NULL REFERENCES workers(id),
  ended_by_worker_id TEXT REFERENCES workers(id),
  last_allocated_display_order_no INTEGER NOT NULL CHECK (last_allocated_display_order_no >= 0),
  payload_json TEXT NOT NULL,
  CHECK ((status = 'OPEN' AND ended_at IS NULL AND ended_by_worker_id IS NULL) OR
         (status = 'CLOSED' AND ended_at IS NOT NULL AND ended_by_worker_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_business_days_one_open_per_shop ON business_days(shop_id) WHERE status = 'OPEN';

CREATE TABLE worker_sessions (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT NOT NULL REFERENCES business_days(id),
  worker_id TEXT NOT NULL REFERENCES workers(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_worker_sessions_business_day ON worker_sessions(business_day_id);

CREATE TABLE configuration_snapshots (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE customer_contacts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  normalized_phone TEXT NOT NULL,
  display_phone TEXT NOT NULL,
  name TEXT NOT NULL,
  last_order_at TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE (shop_id, normalized_phone)
);
CREATE INDEX idx_customer_contacts_shop_phone ON customer_contacts(shop_id, normalized_phone);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT NOT NULL REFERENCES business_days(id),
  display_order_no INTEGER NOT NULL CHECK (display_order_no > 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DONE', 'CANCELLED', 'RETURNED')),
  source TEXT NOT NULL,
  operator_worker_id TEXT NOT NULL REFERENCES workers(id),
  created_at TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  payload_json TEXT NOT NULL,
  UNIQUE (shop_id, business_day_id, display_order_no),
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX idx_orders_business_day_status ON orders(business_day_id, status, created_at);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT NOT NULL REFERENCES business_days(id),
  kind TEXT NOT NULL CHECK (kind IN ('MANUAL', 'DELIVERY_FAILED')),
  amount_minor INTEGER,
  paid_from TEXT CHECK (paid_from IN ('CASH', 'OTHER')),
  order_id TEXT REFERENCES orders(id),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  CHECK ((kind = 'MANUAL' AND amount_minor IS NOT NULL AND amount_minor >= 0 AND paid_from IS NOT NULL AND order_id IS NULL) OR
         (kind = 'DELIVERY_FAILED' AND amount_minor IS NULL AND paid_from IS NULL AND order_id IS NOT NULL))
);
CREATE INDEX idx_expenses_business_day ON expenses(business_day_id, created_at);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('RECIPE_TRACKED', 'BULK_MANUAL')),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_inventory_items_shop ON inventory_items(shop_id, tracking_mode);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT REFERENCES business_days(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  movement_type TEXT NOT NULL,
  quantity_delta_micros INTEGER NOT NULL CHECK (quantity_delta_micros <> 0),
  idempotency_key TEXT NOT NULL,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  order_id TEXT REFERENCES orders(id),
  created_at TEXT NOT NULL,
  compensates_movement_id TEXT REFERENCES inventory_movements(id),
  payload_json TEXT NOT NULL,
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX idx_inventory_movements_item ON inventory_movements(item_id, created_at);
CREATE INDEX idx_inventory_movements_business_day ON inventory_movements(business_day_id, created_at);

CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT NOT NULL REFERENCES business_days(id),
  created_by_worker_id TEXT NOT NULL REFERENCES workers(id),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (shop_id, business_day_id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT REFERENCES business_days(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  worker_id TEXT REFERENCES workers(id),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_audit_events_aggregate ON audit_events(aggregate_type, aggregate_id, created_at);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  business_day_id TEXT REFERENCES business_days(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  last_error TEXT,
  delivered_at TEXT,
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX idx_outbox_pending ON outbox_events(delivered_at, next_attempt_at, created_at);
`,
  },
  {
    version: 2,
    name: 'one_open_worker_session_per_business_day',
    sql: `
CREATE UNIQUE INDEX ux_worker_sessions_one_open_per_business_day
ON worker_sessions(business_day_id)
WHERE ended_at IS NULL;
`,
  },
];

export function applySqliteMigrations(database: DatabaseSync): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const appliedRows = database.prepare('SELECT version FROM local_schema_migrations').all();
  const applied = new Set(appliedRows.map((row) => Number(row['version'])));

  for (const migration of SQLITE_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO local_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) {
        database.exec('ROLLBACK');
      }
      throw error;
    }
  }
}

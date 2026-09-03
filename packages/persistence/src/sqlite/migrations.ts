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
  {
    version: 3,
    name: 'orders_board_lookup_indexes',
    sql: `
CREATE INDEX idx_inventory_movements_order ON inventory_movements(order_id, created_at);
`,
  },
  {
    version: 4,
    name: 'outbox_permanent_failure_quarantine',
    sql: `
ALTER TABLE outbox_events ADD COLUMN quarantined_at TEXT;
ALTER TABLE outbox_events ADD COLUMN permanent_failure_reason TEXT;
CREATE INDEX idx_outbox_quarantined ON outbox_events(quarantined_at, created_at);
`,
  },
  {
    version: 5,
    name: 'outbox_aggregate_dependency_ordering',
    sql: `
ALTER TABLE outbox_events ADD COLUMN aggregate_revision INTEGER
  CHECK (aggregate_revision IS NULL OR aggregate_revision >= 0);
ALTER TABLE outbox_events ADD COLUMN blocked_by_event_id TEXT REFERENCES outbox_events(id);

UPDATE outbox_events SET aggregate_revision = 0
WHERE aggregate_type = 'ORDER' AND event_type = 'ORDER_PLACED';
UPDATE outbox_events SET aggregate_revision = json_extract(payload_json, '$.payload.transition.revision')
WHERE aggregate_type = 'ORDER' AND event_type IN ('ORDER_MARKED_DONE', 'ORDER_DONE_UNDONE', 'ORDER_CANCELLED', 'DELIVERY_RETURNED');
UPDATE outbox_events SET aggregate_revision = json_extract(payload_json, '$.payload.expense.lifecycle.revision')
WHERE aggregate_type = 'EXPENSE';
UPDATE outbox_events SET aggregate_revision = CASE event_type
  WHEN 'BUSINESS_DAY_STARTED' THEN 0 WHEN 'BUSINESS_DAY_CLOSED' THEN 1 ELSE aggregate_revision END
WHERE aggregate_type = 'BUSINESS_DAY';
UPDATE outbox_events SET aggregate_revision = CASE event_type
  WHEN 'WORKER_SIGNED_IN' THEN 0 WHEN 'WORKER_SWITCHED' THEN 0 WHEN 'WORKER_SIGNED_OUT' THEN 1 ELSE aggregate_revision END
WHERE aggregate_type = 'WORKER_SESSION';

CREATE INDEX idx_outbox_aggregate_stream
ON outbox_events(shop_id, aggregate_type, aggregate_id, aggregate_revision, created_at);
CREATE INDEX idx_outbox_dependency_block
ON outbox_events(blocked_by_event_id, created_at);
`,
  },
  {
    version: 6,
    name: 'worker_ui_preferences',
    sql: `
CREATE TABLE IF NOT EXISTS worker_ui_preferences (
  shop_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  category_order_json TEXT NOT NULL,
  category_alignment TEXT NOT NULL CHECK (category_alignment IN ('left','center','right')),
  updated_at TEXT NOT NULL,
  server_version INTEGER NOT NULL CHECK (server_version >= 0),
  sync_state TEXT NOT NULL CHECK (sync_state IN ('CLEAN','DIRTY')),
  PRIMARY KEY (shop_id, worker_id)
);
`,
  },
  {
    version: 7,
    name: 'worker_ui_product_order',
    sql: `
ALTER TABLE worker_ui_preferences
ADD COLUMN product_order_json TEXT NOT NULL DEFAULT '[]';
`,
  },
  {
    version: 8,
    name: 'worker_ui_accent_color',
    sql: `
ALTER TABLE worker_ui_preferences
ADD COLUMN accent_color TEXT;
`,
  },
  {
    version: 9,
    name: 'worker_menu_layouts',
    sql: `
CREATE TABLE worker_menu_layouts (
  shop_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  category_order_json TEXT NOT NULL,
  category_alignment TEXT NOT NULL CHECK (category_alignment IN ('left','center','right')),
  product_order_by_category_json TEXT NOT NULL,
  layout_version INTEGER NOT NULL CHECK (layout_version >= 0),
  updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL CHECK (sync_state IN ('CLEAN','DIRTY')),
  PRIMARY KEY (shop_id, worker_id)
);

WITH category_rows AS (
  SELECT
    pref.shop_id,
    pref.worker_id,
    CAST(category_order.key AS INTEGER) AS ord,
    category_order.value AS category_id
  FROM worker_ui_preferences pref
  JOIN configuration_snapshots config ON config.shop_id = pref.shop_id
  JOIN json_each(pref.category_order_json) category_order
  JOIN json_each(json_extract(config.payload_json, '$.categories')) category
    ON json_extract(category.value, '$.id') = category_order.value
   AND json_extract(category.value, '$.shopId') = pref.shop_id
   AND json_extract(category.value, '$.active') = 1
),
category_json AS (
  SELECT shop_id, worker_id, json_group_array(category_id) AS category_order_json
  FROM (SELECT * FROM category_rows ORDER BY shop_id, worker_id, ord)
  GROUP BY shop_id, worker_id
),
product_rows AS (
  SELECT
    pref.shop_id,
    pref.worker_id,
    CAST(product_order.key AS INTEGER) AS ord,
    product_order.value AS product_id,
    json_extract(product.value, '$.categoryId') AS category_id
  FROM worker_ui_preferences pref
  JOIN configuration_snapshots config ON config.shop_id = pref.shop_id
  JOIN json_each(pref.product_order_json) product_order
  JOIN json_each(json_extract(config.payload_json, '$.products')) product
    ON json_extract(product.value, '$.id') = product_order.value
   AND json_extract(product.value, '$.shopId') = pref.shop_id
   AND json_extract(product.value, '$.active') = 1
  JOIN json_each(json_extract(config.payload_json, '$.categories')) category
    ON json_extract(category.value, '$.id') = json_extract(product.value, '$.categoryId')
   AND json_extract(category.value, '$.shopId') = pref.shop_id
   AND json_extract(category.value, '$.active') = 1
),
per_category AS (
  SELECT shop_id, worker_id, category_id, json_group_array(product_id) AS products_json
  FROM (SELECT * FROM product_rows ORDER BY shop_id, worker_id, category_id, ord)
  GROUP BY shop_id, worker_id, category_id
),
product_json AS (
  SELECT shop_id, worker_id, json_group_object(category_id, json(products_json)) AS mapping
  FROM per_category
  GROUP BY shop_id, worker_id
)
INSERT INTO worker_menu_layouts(
  shop_id,
  worker_id,
  category_order_json,
  category_alignment,
  product_order_by_category_json,
  layout_version,
  updated_at,
  sync_state
)
SELECT
  pref.shop_id,
  pref.worker_id,
  COALESCE(category_json.category_order_json, '[]'),
  pref.category_alignment,
  COALESCE(product_json.mapping, '{}'),
  pref.server_version,
  pref.updated_at,
  pref.sync_state
FROM worker_ui_preferences pref
LEFT JOIN category_json USING (shop_id, worker_id)
LEFT JOIN product_json USING (shop_id, worker_id);
`,
  },
  {
    version: 10,
    name: 'whatsapp_local_cache',
    sql: `
CREATE TABLE whatsapp_cache_conversations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  last_message_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_conversations_shop_last
  ON whatsapp_cache_conversations(shop_id, last_message_at, id);

CREATE TABLE whatsapp_cache_messages (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_messages_conversation_created
  ON whatsapp_cache_messages(shop_id, conversation_id, created_at, id);

CREATE TABLE whatsapp_cache_quick_replies (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_quick_replies_shop
  ON whatsapp_cache_quick_replies(shop_id, id);

CREATE TABLE whatsapp_cache_order_links (
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (shop_id, conversation_id, order_id)
);

CREATE TABLE whatsapp_drafts (
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, conversation_id)
);
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
    if (applied.has(migration.version)) continue;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO local_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  }
}

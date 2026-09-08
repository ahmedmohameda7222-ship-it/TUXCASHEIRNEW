import { DatabaseSync } from 'node:sqlite';
import type { ShopId } from '@tux/domain';
import {
  parseCachedOnlineOrderRequest,
  type CachedOnlineOrderRequest,
  type OnlineOrderInboxStore,
} from '../onlineOrderInboxStore';

interface InboxRow {
  readonly request_id: unknown;
  readonly payload_json: unknown;
}

function parseRow(row: InboxRow, expectedShopId: ShopId): CachedOnlineOrderRequest {
  if (typeof row.payload_json !== 'string') {
    throw new Error('SQLite online-order inbox payload_json must be text.');
  }
  const parsed = parseCachedOnlineOrderRequest(JSON.parse(row.payload_json) as unknown);
  if (parsed.shopId !== expectedShopId || parsed.requestId !== row.request_id) {
    throw new Error('SQLite online-order inbox row authority does not match its payload.');
  }
  return parsed;
}

export class SqliteOnlineOrderInboxStore implements OnlineOrderInboxStore {
  readonly #database: DatabaseSync;
  #initialized = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#database.exec('PRAGMA synchronous = FULL;');
    this.#database.exec('PRAGMA busy_timeout = 5000;');
    this.#database.exec(
      `CREATE TABLE IF NOT EXISTS local_online_order_inbox_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );`,
    );
    this.#applyMigration(
      1,
      'online_order_inbox',
      `
CREATE TABLE IF NOT EXISTS online_order_inbox (
  shop_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (shop_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_online_order_inbox_shop_created
  ON online_order_inbox(shop_id, created_at, request_id);`,
    );
    this.#initialized = true;
  }

  async upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void> {
    this.#assertInitialized();
    const validated = requests.map((request) => parseCachedOnlineOrderRequest(request));
    if (validated.length === 0) return;
    const statement = this.#database.prepare(
      `INSERT INTO online_order_inbox(shop_id, request_id, created_at, payload_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(shop_id, request_id) DO UPDATE SET
         created_at = excluded.created_at,
         payload_json = excluded.payload_json`,
    );
    this.#transaction(() => {
      for (const request of validated) {
        statement.run(
          request.shopId,
          request.requestId,
          request.createdAt,
          JSON.stringify(request),
        );
      }
    });
  }

  async list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]> {
    this.#assertInitialized();
    const rows = this.#database
      .prepare(
        `SELECT request_id, payload_json
         FROM online_order_inbox
         WHERE shop_id = ?
         ORDER BY created_at ASC, request_id ASC`,
      )
      .all(shopId) as unknown as InboxRow[];
    return rows.map((row) => parseRow(row, shopId));
  }

  async remove(shopId: ShopId, requestId: string): Promise<void> {
    this.#assertInitialized();
    this.#database
      .prepare('DELETE FROM online_order_inbox WHERE shop_id = ? AND request_id = ?')
      .run(shopId, requestId);
  }

  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }

  #applyMigration(version: number, name: string, sql: string): void {
    const existing = this.#database
      .prepare('SELECT version FROM local_online_order_inbox_schema_migrations WHERE version = ?')
      .get(version);
    if (existing !== undefined) return;
    this.#transaction(() => {
      this.#database.exec(sql);
      this.#database
        .prepare(
          `INSERT INTO local_online_order_inbox_schema_migrations(version, name, applied_at)
           VALUES (?, ?, ?)`,
        )
        .run(version, name, new Date().toISOString());
    });
  }

  #transaction<Result>(operation: () => Result): Result {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new Error('SQLite online-order inbox store must be initialized before use.');
    }
  }
}

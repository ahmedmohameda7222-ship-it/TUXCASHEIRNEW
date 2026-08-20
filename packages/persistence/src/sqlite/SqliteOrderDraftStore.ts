import { DatabaseSync } from 'node:sqlite';
import { parseOrderDraft, type OrderDraft } from '@tux/domain';
import type { OrderDraftKey, OrderDraftStore } from '../orderDraftStore';

const DRAFT_SCHEMA_VERSION = 1;

function serialize(draft: OrderDraft): string {
  return JSON.stringify(draft);
}

function parseDraft(row: unknown): OrderDraft | null {
  if (row === undefined) {
    return null;
  }
  if (typeof row !== 'object' || row === null || !('payload_json' in row)) {
    throw new Error('SQLite draft row is missing payload_json.');
  }
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') {
    throw new Error('SQLite draft payload_json must be text.');
  }
  return parseOrderDraft(JSON.parse(payload) as unknown);
}

export class SqliteOrderDraftStore implements OrderDraftStore {
  readonly #database: DatabaseSync;
  #initialized = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    this.#database.exec('PRAGMA synchronous = FULL;');
    this.#database.exec('PRAGMA busy_timeout = 5000;');
    this.#database.exec(`
CREATE TABLE IF NOT EXISTS local_draft_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
    const applied = this.#database
      .prepare('SELECT version FROM local_draft_schema_migrations WHERE version = ?')
      .get(DRAFT_SCHEMA_VERSION);
    if (applied === undefined) {
      this.#database.exec('BEGIN IMMEDIATE');
      try {
        this.#database.exec(`
CREATE TABLE IF NOT EXISTS order_drafts (
  shop_id TEXT NOT NULL,
  business_day_id TEXT NOT NULL,
  draft_scope_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  checkout_intent_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (shop_id, business_day_id, draft_scope_id)
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_checkout_intent
  ON order_drafts(shop_id, checkout_intent_key);
`);
        this.#database
          .prepare(
            'INSERT INTO local_draft_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
          )
          .run(DRAFT_SCHEMA_VERSION, 'order_draft_store', new Date().toISOString());
        this.#database.exec('COMMIT');
      } catch (error) {
        if (this.#database.isTransaction) {
          this.#database.exec('ROLLBACK');
        }
        throw error;
      }
    }
    this.#initialized = true;
  }

  async get(key: OrderDraftKey): Promise<OrderDraft | null> {
    this.#assertInitialized();
    return parseDraft(
      this.#database
        .prepare(
          `SELECT payload_json FROM order_drafts
           WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
        )
        .get(key.shopId, key.businessDayId, key.draftScopeId),
    );
  }

  async put(draft: OrderDraft): Promise<void> {
    this.#assertInitialized();
    const validated = parseOrderDraft(draft);
    if (!Number.isSafeInteger(validated.revision) || validated.revision < 0) {
      throw new RangeError('Draft revision must be a non-negative safe integer.');
    }
    if (
      validated.draftScopeId.trim().length === 0 ||
      validated.checkoutIntentKey.trim().length === 0
    ) {
      throw new Error('Draft scope and checkout intent keys are required.');
    }

    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.#database
        .prepare(
          `SELECT revision FROM order_drafts
           WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
        )
        .get(validated.shopId, validated.businessDayId, validated.draftScopeId) as
        | { revision?: unknown }
        | undefined;
      if (existing !== undefined && Number(existing.revision) > validated.revision) {
        throw new Error('Refusing to overwrite a newer durable order draft revision.');
      }

      this.#database
        .prepare(
          `INSERT INTO order_drafts(
             shop_id, business_day_id, draft_scope_id, revision,
             checkout_intent_key, updated_at, payload_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(shop_id, business_day_id, draft_scope_id) DO UPDATE SET
             revision = excluded.revision,
             checkout_intent_key = excluded.checkout_intent_key,
             updated_at = excluded.updated_at,
             payload_json = excluded.payload_json`,
        )
        .run(
          validated.shopId,
          validated.businessDayId,
          validated.draftScopeId,
          validated.revision,
          validated.checkoutIntentKey,
          validated.updatedAt,
          serialize(validated),
        );
      this.#database.exec('COMMIT');
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  async delete(key: OrderDraftKey): Promise<void> {
    this.#assertInitialized();
    this.#database
      .prepare(
        `DELETE FROM order_drafts
         WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
      )
      .run(key.shopId, key.businessDayId, key.draftScopeId);
  }

  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }

  #assertInitialized(): void {
    if (!this.#initialized) {
      throw new Error('SQLite order draft store must be initialized before use.');
    }
  }
}

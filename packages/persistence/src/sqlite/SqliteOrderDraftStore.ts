import { DatabaseSync } from 'node:sqlite';
import {
  assertParkedOrderDraftInvariant,
  parseOrderDraft,
  type BusinessDayId,
  type OrderDraft,
  type ParkedOrderDraft,
  type ShopId,
} from '@tux/domain';
import type {
  OrderDraftKey,
  OrderDraftStore,
  ParkAndReplaceOrderDraftInput,
  ResolveParkedOrderDraftInput,
  RestoreParkedOrderDraftInput,
} from '../orderDraftStore';

function serialize(value: OrderDraft | ParkedOrderDraft): string {
  return JSON.stringify(value);
}
function parseDraft(row: unknown): OrderDraft | null {
  if (row === undefined) return null;
  if (typeof row !== 'object' || row === null || !('payload_json' in row))
    throw new Error('SQLite draft row is missing payload_json.');
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') throw new Error('SQLite draft payload_json must be text.');
  return parseOrderDraft(JSON.parse(payload) as unknown);
}
function parseParked(row: unknown): ParkedOrderDraft | null {
  if (row === undefined) return null;
  if (typeof row !== 'object' || row === null || !('payload_json' in row))
    throw new Error('SQLite parked draft row is missing payload_json.');
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string')
    throw new Error('SQLite parked draft payload_json must be text.');
  const raw = JSON.parse(payload) as ParkedOrderDraft;
  const parsed: ParkedOrderDraft = { ...raw, draft: parseOrderDraft(raw.draft) };
  assertParkedOrderDraftInvariant(parsed);
  return parsed;
}
function sameAuthority(
  value: Pick<OrderDraft, 'shopId' | 'businessDayId' | 'draftScopeId'>,
  key: OrderDraftKey,
): boolean {
  return (
    value.shopId === key.shopId &&
    value.businessDayId === key.businessDayId &&
    value.draftScopeId === key.draftScopeId
  );
}
function assertParkSnapshot(
  record: ParkedOrderDraft,
  active: OrderDraft,
  key: OrderDraftKey,
): void {
  assertParkedOrderDraftInvariant(record);
  if (!sameAuthority(record, key) || JSON.stringify(record.draft) !== JSON.stringify(active))
    throw new Error(
      'Parked order draft must snapshot the current active draft authority and payload.',
    );
}
function assertReplacement(draft: OrderDraft, key: OrderDraftKey): OrderDraft {
  const parsed = parseOrderDraft(draft);
  if (!sameAuthority(parsed, key))
    throw new Error('Replacement order draft authority must match the active key.');
  return parsed;
}

export class SqliteOrderDraftStore implements OrderDraftStore {
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
      `CREATE TABLE IF NOT EXISTS local_draft_schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`,
    );
    this.#applyMigration(
      1,
      'order_draft_store',
      `
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
CREATE INDEX IF NOT EXISTS idx_order_drafts_checkout_intent ON order_drafts(shop_id, checkout_intent_key);`,
    );
    this.#applyMigration(
      2,
      'parked_order_drafts',
      `
CREATE TABLE IF NOT EXISTS parked_order_drafts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  business_day_id TEXT NOT NULL,
  draft_scope_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PARKED','RESTORED','DISCARDED')),
  parked_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parked_order_drafts_authority_state_time ON parked_order_drafts(shop_id, business_day_id, state, parked_at, id);
CREATE INDEX IF NOT EXISTS idx_parked_order_drafts_authority_scope ON parked_order_drafts(shop_id, business_day_id, draft_scope_id);`,
    );
    this.#initialized = true;
  }
  async get(key: OrderDraftKey): Promise<OrderDraft | null> {
    this.#assertInitialized();
    return parseDraft(
      this.#database
        .prepare(
          `SELECT payload_json FROM order_drafts WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
        )
        .get(key.shopId, key.businessDayId, key.draftScopeId),
    );
  }
  async put(draft: OrderDraft): Promise<void> {
    this.#assertInitialized();
    const validated = parseOrderDraft(draft);
    if (!Number.isSafeInteger(validated.revision) || validated.revision < 0)
      throw new RangeError('Draft revision must be a non-negative safe integer.');
    if (
      validated.draftScopeId.trim().length === 0 ||
      validated.checkoutIntentKey.trim().length === 0
    )
      throw new Error('Draft scope and checkout intent keys are required.');
    this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT revision FROM order_drafts WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
        )
        .get(validated.shopId, validated.businessDayId, validated.draftScopeId) as
        { revision?: unknown } | undefined;
      if (existing !== undefined && Number(existing.revision) > validated.revision)
        throw new Error('Refusing to overwrite a newer durable order draft revision.');
      this.#writeDraft(validated);
    });
  }
  async delete(key: OrderDraftKey): Promise<void> {
    this.#assertInitialized();
    this.#database
      .prepare(
        `DELETE FROM order_drafts WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
      )
      .run(key.shopId, key.businessDayId, key.draftScopeId);
  }
  async listParked(
    shopId: ShopId,
    businessDayId: BusinessDayId,
  ): Promise<readonly ParkedOrderDraft[]> {
    this.#assertInitialized();
    const rows = this.#database
      .prepare(
        `SELECT payload_json FROM parked_order_drafts WHERE shop_id = ? AND business_day_id = ? AND state = 'PARKED' ORDER BY parked_at ASC, id ASC`,
      )
      .all(shopId, businessDayId);
    return rows.map((row) => {
      const parsed = parseParked(row);
      if (parsed === null) throw new Error('Parked order draft disappeared.');
      return parsed;
    });
  }
  async parkAndReplace(input: ParkAndReplaceOrderDraftInput): Promise<ParkedOrderDraft> {
    this.#assertInitialized();
    const replacement = assertReplacement(input.replacement, input.activeKey);
    return this.#transaction(() => {
      const active = this.#activeDraft(input.activeKey);
      if (active === null) throw new Error('Active order draft was not found.');
      if (active.revision !== input.expectedActiveRevision)
        throw new Error('Active order draft revision changed.');
      assertParkSnapshot(input.parked, active, input.activeKey);
      if (this.#parkedById(input.parked.id) !== null)
        throw new Error('Parked order draft id already exists.');
      this.#writeParked(input.parked);
      this.#writeDraft(replacement);
      return input.parked;
    });
  }
  async restoreParked(input: RestoreParkedOrderDraftInput): Promise<{
    readonly restoredDraft: OrderDraft;
    readonly parkedActive: ParkedOrderDraft | null;
  }> {
    this.#assertInitialized();
    return this.#transaction(() => {
      const selected = this.#parkedById(input.parkedId);
      if (selected === null) throw new Error('Parked order draft was not found.');
      if (
        selected.shopId !== input.activeKey.shopId ||
        selected.businessDayId !== input.activeKey.businessDayId ||
        selected.draftScopeId !== input.activeKey.draftScopeId ||
        selected.state !== 'PARKED'
      )
        throw new Error('Parked order draft does not belong to the active authority.');
      const active = this.#activeDraft(input.activeKey);
      if (active === null) throw new Error('Active order draft was not found.');
      if (active.revision !== input.expectedActiveRevision)
        throw new Error('Active order draft revision changed.');
      let parkedActive: ParkedOrderDraft | null = null;
      if (input.parkActiveAs !== null) {
        assertParkSnapshot(input.parkActiveAs, active, input.activeKey);
        if (this.#parkedById(input.parkActiveAs.id) !== null)
          throw new Error('Parked active draft id already exists.');
        parkedActive = input.parkActiveAs;
        this.#writeParked(parkedActive);
      }
      const resolved: ParkedOrderDraft = {
        ...selected,
        state: 'RESTORED',
        resolvedAt: input.restoredAt,
        resolvedByWorkerId: input.restoredByWorkerId,
      };
      assertParkedOrderDraftInvariant(resolved);
      this.#writeParked(resolved);
      this.#writeDraft(selected.draft);
      return { restoredDraft: selected.draft, parkedActive };
    });
  }
  async discardParked(input: ResolveParkedOrderDraftInput): Promise<ParkedOrderDraft> {
    this.#assertInitialized();
    return this.#transaction(() => {
      const selected = this.#parkedById(input.parkedId);
      if (selected === null) throw new Error('Parked order draft was not found.');
      if (
        selected.shopId !== input.shopId ||
        selected.businessDayId !== input.businessDayId ||
        selected.state !== 'PARKED'
      )
        throw new Error('Parked order draft does not belong to the requested authority.');
      const resolved: ParkedOrderDraft = {
        ...selected,
        state: 'DISCARDED',
        resolvedAt: input.resolvedAt,
        resolvedByWorkerId: input.resolvedByWorkerId,
      };
      assertParkedOrderDraftInvariant(resolved);
      this.#writeParked(resolved);
      return resolved;
    });
  }
  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }
  #applyMigration(version: number, name: string, sql: string): void {
    if (
      this.#database
        .prepare('SELECT version FROM local_draft_schema_migrations WHERE version = ?')
        .get(version) !== undefined
    )
      return;
    this.#transaction(() => {
      this.#database.exec(sql);
      this.#database
        .prepare(
          'INSERT INTO local_draft_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
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
  #activeDraft(key: OrderDraftKey): OrderDraft | null {
    return parseDraft(
      this.#database
        .prepare(
          `SELECT payload_json FROM order_drafts WHERE shop_id = ? AND business_day_id = ? AND draft_scope_id = ?`,
        )
        .get(key.shopId, key.businessDayId, key.draftScopeId),
    );
  }
  #parkedById(id: string): ParkedOrderDraft | null {
    return parseParked(
      this.#database.prepare(`SELECT payload_json FROM parked_order_drafts WHERE id = ?`).get(id),
    );
  }
  #writeDraft(draft: OrderDraft): void {
    this.#database
      .prepare(
        `INSERT INTO order_drafts(shop_id,business_day_id,draft_scope_id,revision,checkout_intent_key,updated_at,payload_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(shop_id,business_day_id,draft_scope_id) DO UPDATE SET revision=excluded.revision, checkout_intent_key=excluded.checkout_intent_key, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      )
      .run(
        draft.shopId,
        draft.businessDayId,
        draft.draftScopeId,
        draft.revision,
        draft.checkoutIntentKey,
        draft.updatedAt,
        serialize(draft),
      );
  }
  #writeParked(record: ParkedOrderDraft): void {
    this.#database
      .prepare(
        `INSERT INTO parked_order_drafts(id,shop_id,business_day_id,draft_scope_id,state,parked_at,payload_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET shop_id=excluded.shop_id,business_day_id=excluded.business_day_id,draft_scope_id=excluded.draft_scope_id,state=excluded.state,parked_at=excluded.parked_at,payload_json=excluded.payload_json`,
      )
      .run(
        record.id,
        record.shopId,
        record.businessDayId,
        record.draftScopeId,
        record.state,
        record.parkedAt,
        serialize(record),
      );
  }
  #assertInitialized(): void {
    if (!this.#initialized)
      throw new Error('SQLite order draft store must be initialized before use.');
  }
}

import type { DatabaseSync } from 'node:sqlite';
import {
  parseWorkerUiPreferences,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '../workerUiPreferencesStore';

function readPreferences(row: unknown): WorkerUiPreferences | null {
  if (row === undefined) return null;
  if (typeof row !== 'object' || row === null) {
    throw new TypeError('SQLite worker UI preference row is invalid.');
  }
  const record = row as Record<string, unknown>;
  if (typeof record['category_order_json'] !== 'string') {
    throw new TypeError('SQLite worker UI preference category_order_json must be text.');
  }
  if (typeof record['product_order_json'] !== 'string') {
    throw new TypeError('SQLite worker UI preference product_order_json must be text.');
  }
  return parseWorkerUiPreferences({
    shopId: record['shop_id'],
    workerId: record['worker_id'],
    categoryOrder: JSON.parse(record['category_order_json']) as unknown,
    categoryAlignment: record['category_alignment'],
    productOrder: JSON.parse(record['product_order_json']) as unknown,
    updatedAt: record['updated_at'],
    serverVersion: Number(record['server_version']),
    syncState: record['sync_state'],
  });
}

export function createSqliteWorkerUiPreferencesRepository(
  database: DatabaseSync,
): WorkerUiPreferencesRepository {
  return {
    async get(shopId, workerId) {
      return readPreferences(
        database
          .prepare(
            `SELECT shop_id, worker_id, category_order_json, category_alignment,
                    product_order_json, updated_at, server_version, sync_state
             FROM worker_ui_preferences WHERE shop_id = ? AND worker_id = ?`,
          )
          .get(shopId, workerId),
      );
    },
    async put(preferences) {
      const value = parseWorkerUiPreferences(preferences);
      database
        .prepare(
          `INSERT INTO worker_ui_preferences(
             shop_id, worker_id, category_order_json, category_alignment, product_order_json,
             updated_at, server_version, sync_state
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(shop_id, worker_id) DO UPDATE SET
             category_order_json = excluded.category_order_json,
             category_alignment = excluded.category_alignment,
             product_order_json = excluded.product_order_json,
             updated_at = excluded.updated_at,
             server_version = excluded.server_version,
             sync_state = excluded.sync_state`,
        )
        .run(
          value.shopId,
          value.workerId,
          JSON.stringify(value.categoryOrder),
          value.categoryAlignment,
          JSON.stringify(value.productOrder),
          value.updatedAt,
          value.serverVersion,
          value.syncState,
        );
    },
    async delete(shopId, workerId) {
      database
        .prepare('DELETE FROM worker_ui_preferences WHERE shop_id = ? AND worker_id = ?')
        .run(shopId, workerId);
    },
  };
}

export class SqliteWorkerUiPreferencesStore implements WorkerUiPreferencesRepository {
  readonly #repository: WorkerUiPreferencesRepository;

  constructor(database: DatabaseSync) {
    this.#repository = createSqliteWorkerUiPreferencesRepository(database);
  }

  get(shopId: ShopId, workerId: WorkerId): Promise<WorkerUiPreferences | null> {
    return this.#repository.get(shopId, workerId);
  }

  put(preferences: WorkerUiPreferences): Promise<void> {
    return this.#repository.put(preferences);
  }

  delete(shopId: ShopId, workerId: WorkerId): Promise<void> {
    return this.#repository.delete(shopId, workerId);
  }
}

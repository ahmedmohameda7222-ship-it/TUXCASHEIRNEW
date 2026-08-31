import { DatabaseSync } from 'node:sqlite';
import {
  parseWorkerMenuLayout,
  type OperationsConfigurationSnapshot,
  type ShopId,
  type WorkerId,
  type WorkerMenuLayout,
  type WorkerMenuLayoutCatalog,
} from '@tux/domain';
import type { WorkerMenuLayoutRepository } from '../workerMenuLayoutStore';
import { applySqliteMigrations } from './migrations';

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'string') throw new TypeError(`${label} must be JSON text.`);
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export class SqliteWorkerMenuLayoutStore implements WorkerMenuLayoutRepository {
  readonly #path: string;
  #database: DatabaseSync | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    const database = new DatabaseSync(this.#path);
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    applySqliteMigrations(database);
    this.#database = database;
  }

  #requiredDatabase(): DatabaseSync {
    if (this.#database === null) throw new Error('Worker Menu Layout SQLite store is not initialized.');
    return this.#database;
  }

  async get(shopId: ShopId, workerId: WorkerId): Promise<WorkerMenuLayout | null> {
    const row = this.#requiredDatabase()
      .prepare(
        `SELECT shop_id, worker_id, category_order_json, category_alignment,
                product_order_by_category_json, layout_version, updated_at, sync_state
         FROM worker_menu_layouts WHERE shop_id = ? AND worker_id = ?`,
      )
      .get(shopId, workerId);
    if (row === undefined) return null;
    return parseWorkerMenuLayout({
      shopId: row['shop_id'],
      workerId: row['worker_id'],
      categoryOrder: JSON.parse(String(row['category_order_json'])),
      categoryAlignment: row['category_alignment'],
      productOrderByCategory: JSON.parse(String(row['product_order_by_category_json'])),
      layoutVersion: Number(row['layout_version']),
      updatedAt: row['updated_at'],
      syncState: row['sync_state'],
    });
  }

  async put(layout: WorkerMenuLayout): Promise<void> {
    const parsed = parseWorkerMenuLayout(layout);
    this.#requiredDatabase()
      .prepare(
        `INSERT INTO worker_menu_layouts(
          shop_id, worker_id, category_order_json, category_alignment,
          product_order_by_category_json, layout_version, updated_at, sync_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(shop_id, worker_id) DO UPDATE SET
          category_order_json = excluded.category_order_json,
          category_alignment = excluded.category_alignment,
          product_order_by_category_json = excluded.product_order_by_category_json,
          layout_version = excluded.layout_version,
          updated_at = excluded.updated_at,
          sync_state = excluded.sync_state`,
      )
      .run(
        parsed.shopId,
        parsed.workerId,
        JSON.stringify(parsed.categoryOrder),
        parsed.categoryAlignment,
        JSON.stringify(parsed.productOrderByCategory),
        parsed.layoutVersion,
        parsed.updatedAt,
        parsed.syncState,
      );
  }

  async delete(shopId: ShopId, workerId: WorkerId): Promise<void> {
    this.#requiredDatabase()
      .prepare('DELETE FROM worker_menu_layouts WHERE shop_id = ? AND worker_id = ?')
      .run(shopId, workerId);
  }

  async getCatalog(shopId: ShopId): Promise<WorkerMenuLayoutCatalog> {
    const row = this.#requiredDatabase()
      .prepare('SELECT payload_json FROM configuration_snapshots WHERE shop_id = ?')
      .get(shopId);
    if (row === undefined) return { categories: [], products: [] };
    const payload = parseJsonObject(row['payload_json'], 'Configuration snapshot payload');
    const snapshot = payload as unknown as OperationsConfigurationSnapshot;
    return {
      categories: Array.isArray(snapshot.categories) ? snapshot.categories : [],
      products: Array.isArray(snapshot.products) ? snapshot.products : [],
    };
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }
}

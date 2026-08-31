import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SQLITE_MIGRATIONS } from './migrations';

const shopId = '71111111-1111-4111-8111-111111111111';
const workerId = '72222222-2222-4222-8222-222222222222';
const categoryAId = '73333333-3333-4333-8333-333333333331';
const categoryBId = '73333333-3333-4333-8333-333333333332';
const productA1Id = '74444444-4444-4444-8444-444444444441';
const productA2Id = '74444444-4444-4444-8444-444444444442';
const productBId = '74444444-4444-4444-8444-444444444443';
const staleProductId = '74444444-4444-4444-8444-444444444499';

function applyThrough(database: DatabaseSync, maxVersion: number): void {
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= maxVersion)) {
    database.exec(migration.sql);
  }
}

describe('SQLite Worker Menu Layout migration', () => {
  it('creates the dedicated table and backfills flat product order by actual category', () => {
    const database = new DatabaseSync(':memory:');
    try {
      applyThrough(database, 8);
      database
        .prepare('INSERT INTO shops(id, name, active, payload_json) VALUES (?, ?, ?, ?)')
        .run(shopId, 'Menu Layout Shop', 1, JSON.stringify({ id: shopId }));
      database
        .prepare(
          'INSERT INTO workers(id, shop_id, display_name, pin_hash, active, payload_json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(workerId, shopId, 'Layout Worker', 'hash', 1, JSON.stringify({ id: workerId, shopId }));

      const configuration = {
        shopId,
        version: 1,
        updatedAt: '2026-08-31T10:00:00.000Z',
        categories: [
          { id: categoryAId, shopId, active: true, sortOrder: 0 },
          { id: categoryBId, shopId, active: true, sortOrder: 1 },
        ],
        products: [
          { id: productA1Id, shopId, categoryId: categoryAId, active: true, sortOrder: 0 },
          { id: productA2Id, shopId, categoryId: categoryAId, active: true, sortOrder: 1 },
          { id: productBId, shopId, categoryId: categoryBId, active: true, sortOrder: 0 },
        ],
      };
      database
        .prepare(
          'INSERT INTO configuration_snapshots(shop_id, version, updated_at, payload_json) VALUES (?, ?, ?, ?)',
        )
        .run(shopId, 1, configuration.updatedAt, JSON.stringify(configuration));
      database
        .prepare(
          `INSERT INTO worker_ui_preferences(
             shop_id, worker_id, category_order_json, category_alignment, updated_at,
             server_version, sync_state, product_order_json, accent_color
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          shopId,
          workerId,
          JSON.stringify([categoryBId, categoryAId]),
          'right',
          '2026-08-31T11:00:00.000Z',
          6,
          'CLEAN',
          JSON.stringify([productA2Id, productBId, staleProductId, productA1Id]),
          '#1E3A8A',
        );

      const migration = SQLITE_MIGRATIONS.find(({ version }) => version === 9);
      expect(migration?.name).toBe('worker_menu_layouts');
      database.exec(migration?.sql ?? '');

      const row = database
        .prepare(
          `SELECT category_order_json, category_alignment, product_order_by_category_json,
                  layout_version, sync_state
           FROM worker_menu_layouts WHERE shop_id = ? AND worker_id = ?`,
        )
        .get(shopId, workerId) as Record<string, unknown>;
      expect(JSON.parse(String(row['category_order_json']))).toEqual([categoryBId, categoryAId]);
      expect(row['category_alignment']).toBe('right');
      expect(JSON.parse(String(row['product_order_by_category_json']))).toEqual({
        [categoryAId]: [productA2Id, productA1Id],
        [categoryBId]: [productBId],
      });
      expect(Number(row['layout_version'])).toBe(6);
      expect(row['sync_state']).toBe('CLEAN');
      expect(
        database
          .prepare(
            'SELECT accent_color FROM worker_ui_preferences WHERE shop_id = ? AND worker_id = ?',
          )
          .get(shopId, workerId)?.['accent_color'],
      ).toBe('#1E3A8A');
    } finally {
      database.close();
    }
  });
});

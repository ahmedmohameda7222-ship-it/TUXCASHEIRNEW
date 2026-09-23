import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { SQLITE_MIGRATIONS } from './migrations';

describe('SQLite canonical inventory convergence schema', () => {
  it('does not require unsynchronized order, business-day, or worker rows', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON;');
      for (const migration of SQLITE_MIGRATIONS) database.exec(migration.sql);

      const foreignKeys = database
        .prepare("PRAGMA foreign_key_list('inventory_movements')")
        .all() as Array<Record<string, unknown>>;
      const constrainedColumns = new Set(foreignKeys.map((row) => String(row['from'])));

      expect(constrainedColumns).toContain('shop_id');
      expect(constrainedColumns).toContain('item_id');
      expect(constrainedColumns).not.toContain('business_day_id');
      expect(constrainedColumns).not.toContain('worker_id');
      expect(constrainedColumns).not.toContain('order_id');
    } finally {
      database.close();
    }
  });
});

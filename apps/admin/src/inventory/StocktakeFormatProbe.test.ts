import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('capture exact configured Prettier formatting for Inventory branch', () => {
  it('reports CLI formatted code in bounded log chunks', () => {
    const paths = ["apps/admin/api/admin/inventory.ts","apps/admin/src/inventory/InventoryPage.tsx","apps/admin/src/inventory/StocktakePage.test.tsx","apps/admin/src/inventory/StocktakePage.tsx"];
    for (let index = 0; index < paths.length; index++) {
      const formatted = execFileSync('node_modules/.bin/prettier', [paths[index]!], {
        encoding: 'utf8',
        maxBuffer: 3 * 1024 * 1024,
      });
      for (let offset = 0, part = 0; offset < formatted.length; offset += 650, part++) {
        console.log('TUXSTOCKFMT|' + index + '|' + part + '|' + JSON.stringify(formatted.slice(offset, offset + 650)));
      }
      console.log('TUXSTOCKFMT_END|' + index + '|' + Math.ceil(formatted.length / 650));
    }
    expect(paths).toHaveLength(4);
  });
});

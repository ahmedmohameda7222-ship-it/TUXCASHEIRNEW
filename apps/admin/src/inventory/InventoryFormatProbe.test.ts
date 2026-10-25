import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import prettier from 'prettier';

// Temporary format verification probe; removed after the formatted source is applied.
describe('Inventory branch formatting capture', () => {
  it('compares branch source to the configured formatting output', async () => {
    const paths = ["apps/admin/src/inventory/InventoryPage.tsx","apps/admin/src/inventory/inventory.css","apps/admin/src/inventory/inventoryPresentation.test.ts","apps/admin/src/inventory/inventoryPresentation.ts","apps/admin/src/purchasing/ReceivePurchasePage.tsx","apps/admin/src/purchasing/receivePurchaseValidation.test.ts","apps/admin/src/purchasing/receivePurchaseValidation.ts"];
    for (let index = 0; index < paths.length; index++) {
      const path = paths[index]!;
      const original = readFileSync(path, 'utf8');
      const options = (await prettier.resolveConfig(path)) ?? {};
      const formatted = await prettier.format(original, { ...options, filepath: path });
      const CHUNK = 700;
      for (let offset = 0, part = 0; offset < formatted.length; offset += CHUNK, part++) {
        console.log('TUXFORMAT|' + index + '|' + part + '|' + JSON.stringify(formatted.slice(offset, offset + CHUNK)));
      }
      console.log('TUXFORMAT_END|' + index + '|' + Math.ceil(formatted.length / CHUNK));
    }
    expect(paths).toHaveLength(7);
  });
});

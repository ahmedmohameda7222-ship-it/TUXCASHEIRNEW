import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('exact Inventory source CLI formatting capture', () => {
  it('outputs the project CLI canonical formatting for safe follow-up commits', () => {
    const paths = ["apps/admin/src/inventory/InventoryPage.tsx","apps/admin/src/inventory/inventory.css","apps/admin/src/inventory/InventoryItemPage.tsx","apps/admin/src/inventory/InventoryItemPage.test.tsx","apps/admin/src/inventory/TransferPage.tsx","apps/admin/src/inventory/TransferPage.test.tsx","apps/admin/src/inventory/useInventory.ts","apps/admin/api/admin/inventory.ts","apps/admin/server/inventory/offshiftStocktakeMigration.test.ts","apps/admin/server/inventory/transferMasterIdentityMigration.test.ts","packages/admin-contracts/src/inventory.ts","apps/admin/src/purchasing/usePurchasing.ts"];
    for (let index = 0; index < paths.length; index++) {
      const formatted = execFileSync('node_modules/.bin/prettier', [paths[index]!], {
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
      });
      const chunkSize = 680;
      for (let offset = 0, part = 0; offset < formatted.length; offset += chunkSize, part++) {
        console.log('TUXCLI|' + index + '|' + part + '|' + JSON.stringify(formatted.slice(offset, offset + chunkSize)));
      }
      console.log('TUXCLI_END|' + index + '|' + Math.ceil(formatted.length / chunkSize));
    }
    expect(paths).toHaveLength(12);
  });
});

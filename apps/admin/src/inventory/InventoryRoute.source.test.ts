import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Admin inventory route', () => {
  it('mounts the real InventoryPage instead of the generic placeholder', async () => {
    const source = await readFile(resolve('apps/admin/src/app/routes.tsx'), 'utf8');
    expect(source).toContain("import { InventoryPage } from '../inventory/InventoryPage';");
    expect(source).toContain("if (route.path === '/inventory') return <InventoryPage />;");
  });
  it('retains one command ID for retries of the same inventory or purchasing intent', async () => {
    const inventorySource = await readFile(resolve('apps/admin/src/inventory/useInventory.ts'), 'utf8');
    const purchasingSource = await readFile(resolve('apps/admin/src/purchasing/usePurchasing.ts'), 'utf8');

    for (const source of [inventorySource, purchasingSource]) {
      expect(source).toContain('createRetainedCommandIds');
      expect(source).toContain('.complete(');
      expect(source).not.toMatch(/commandId:\s*commandId\(\)/);
    }
  });

});

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Admin inventory route', () => {
  it('mounts the real InventoryPage instead of the generic placeholder', async () => {
    const source = await readFile(resolve('apps/admin/src/app/routes.tsx'), 'utf8');
    expect(source).toContain("import { InventoryPage } from '../inventory/InventoryPage';");
    expect(source).toContain("if (route.path === '/inventory') return <InventoryPage />;");
  });
});

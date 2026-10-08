import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const inventoryDirectory = dirname(fileURLToPath(import.meta.url));
const purchasingDirectory = join(inventoryDirectory, '../purchasing');
const read = (directory: string, file: string) => readFileSync(join(directory, file), 'utf8');

describe('inventory and purchasing presentation', () => {
  it('uses focused dialogs for adjustments, waste, and purchase-order creation', () => {
    expect(read(inventoryDirectory, 'AdjustStockSheet.tsx')).toContain('<AdminDialog');
    expect(read(inventoryDirectory, 'RecordWasteSheet.tsx')).toContain('<AdminDialog');
    expect(read(purchasingDirectory, 'PurchaseOrdersPage.tsx')).toContain('<AdminDialog');
  });

  it('keeps storage units, raw identifiers, and version metadata out of primary UI', () => {
    const visible = [
      read(inventoryDirectory, 'ReorderSuggestionsPage.tsx'),
      read(inventoryDirectory, 'StocktakePage.tsx'),
      read(inventoryDirectory, 'TransferPage.tsx'),
      read(inventoryDirectory, 'VarianceReport.tsx'),
      read(purchasingDirectory, 'PurchaseOrdersPage.tsx'),
      read(purchasingDirectory, 'PurchaseOrderPage.tsx'),
    ].join('\n');
    expect(visible).not.toMatch(
      /Par micros|Minimum order micros|minor units|<dt>Version<\/dt>|slice\(0, 8\)/,
    );
    expect(read(inventoryDirectory, 'TransferPage.tsx')).toContain('shop.name');
    expect(read(inventoryDirectory, 'ReorderSuggestionsPage.tsx')).toContain(
      'preferredSupplierName',
    );
  });

  it('supports search and progress in long stock counts and supplier lists', () => {
    expect(read(inventoryDirectory, 'StocktakePage.tsx')).toContain('Search items');
    expect(read(inventoryDirectory, 'StocktakePage.tsx')).toContain('counted');
    expect(read(purchasingDirectory, 'SuppliersPage.tsx')).toContain('Search suppliers');
  });
});

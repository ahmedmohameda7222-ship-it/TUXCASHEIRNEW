import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InventoryDefinitionEditor } from './InventoryDefinitionEditor';

describe('inventory item management', () => {
  it('exposes a first-class add form with safe base unit and tracking selection', () => {
    const html = renderToStaticMarkup(<InventoryDefinitionEditor item={null} pending={false} onCommand={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain('Create inventory item');
    expect(html).toContain('Base unit');
    expect(html).toContain('Tracking mode');
    expect(html).toContain('Low-stock threshold');
  });
  it('discloses archival lifecycle and purchase-unit conversions for existing items', () => {
    const html = renderToStaticMarkup(<InventoryDefinitionEditor item={{
      id: 'item', name: 'Cheese', unitLabel: 'g', trackingMode: 'RECIPE_TRACKED',
      active: true, definitionVersion: 4, lowStockThresholdMicros: null,
      onHandMicros: 0, reservedMicros: 0, availableMicros: 0, weightedUnitCostMinor: 0,
      history: [], conversions: [{
        id: 'conversion', inventoryItemId: 'item', purchaseUnitLabel: 'kg',
        baseMicrosPerPurchaseUnit: 1_000_000_000, active: true, definitionVersion: 1,
      }],
    }} pending={false} onCommand={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain('Archive inventory item');
    expect(html).toContain('Purchase units');
    expect(html).toContain('Add purchase unit');
    expect(html).toContain('kg');
  });
});

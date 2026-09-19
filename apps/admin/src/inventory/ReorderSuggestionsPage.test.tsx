import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReorderSuggestionsPage } from './ReorderSuggestionsPage';

describe('ReorderSuggestionsPage', () => {
  it('shows supplier-aware reorder advice without placing an order', () => {
    const html = renderToStaticMarkup(
      <ReorderSuggestionsPage
        suggestions={[
          {
            inventoryItemId: 'beef',
            itemName: 'Beef',
            unitLabel: 'kg',
            availableMicros: 6_000_000,
            parLevelMicros: 15_000_000,
            reorderPointMicros: 8_000_000,
            incomingMicros: 2_000_000,
            suggestedOrderMicros: 8_000_000,
            preferredSupplierName: 'Prime Foods',
            preferredPurchaseUnitLabel: 'case',
            leadTimeDays: 2,
            minimumOrderMicros: 4_000_000,
            orderMultipleMicros: 2_000_000,
          },
        ]}
      />,
    );

    expect(html).toContain('Reorder suggestions');
    expect(html).toContain('Order 8 kg');
    expect(html).toContain('Prime Foods');
    expect(html).toContain('2 days');
    expect(html).toContain('case');
    expect(html).toContain('Minimum order');
    expect(html).toContain('4 kg');
    expect(html).toContain('Order multiple');
    expect(html).toContain('2 kg');
    expect(html).toContain('never places a supplier order automatically');
  });
});

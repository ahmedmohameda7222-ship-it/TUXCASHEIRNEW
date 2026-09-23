import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ReorderSuggestionsPage } from './ReorderSuggestionsPage';

describe('ReorderSuggestionsPage', () => {
  it('shows supplier-aware reorder math as a recommendation only', () => {
    const html = renderToStaticMarkup(
      <ReorderSuggestionsPage
        suggestions={[
          {
            inventoryItemId: 'item-1',
            itemName: 'Beef',
            unitLabel: 'kg',
            availableMicros: 6_000_000,
            incomingMicros: 2_000_000,
            parLevelMicros: 15_000_000,
            reorderPointMicros: 7_000_000,
            suggestedOrderMicros: 8_000_000,
            preferredSupplierId: 'supplier-1',
            preferredPurchaseUnit: 'case',
            leadTimeDays: 3,
            minimumOrderMicros: 4_000_000,
            orderMultipleMicros: 2_000_000,
            version: 4,
          },
        ]}
        canManage
        saving={false}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('6 kg');
    expect(html).toContain('2 kg');
    expect(html).toContain('15 kg');
    expect(html).toContain('8 kg');
    expect(html.toLowerCase()).toContain('case');
    expect(html.toLowerCase()).toContain('3 days');
    expect(html.toLowerCase()).toContain('recommendation only');
    expect(html.toLowerCase()).toContain('does not create a purchase order');
  });
});

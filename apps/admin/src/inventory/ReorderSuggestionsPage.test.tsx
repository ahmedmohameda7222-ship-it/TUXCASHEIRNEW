import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReorderSuggestionsPage } from './ReorderSuggestionsPage';

describe('ReorderSuggestionsPage', () => {
  it('shows supplier-aware reorder math as a recommendation only', () => {
    render(
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

    expect(screen.getByText('6 kg')).toBeTruthy();
    expect(screen.getByText('2 kg')).toBeTruthy();
    expect(screen.getByText('15 kg')).toBeTruthy();
    expect(screen.getByText('8 kg')).toBeTruthy();
    expect(screen.getByText(/case/i)).toBeTruthy();
    expect(screen.getByText(/3 days/i)).toBeTruthy();
    expect(screen.getByText(/recommendation only/i)).toBeTruthy();
    expect(screen.getByText(/does not create a purchase order/i)).toBeTruthy();
  });
});

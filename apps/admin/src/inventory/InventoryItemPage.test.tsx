import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InventoryItemPage } from './InventoryItemPage';

describe('InventoryItemPage', () => {
  it('shows on-hand, reserved, and available separately', () => {
    const html = renderToStaticMarkup(
      <InventoryItemPage
        item={{
          id: 'inventory-beef',
          name: 'Beef',
          unitLabel: 'kg',
          trackingMode: 'RECIPE_TRACKED',
          active: true,
          onHandMicros: 3_200_000,
          reservedMicros: 1_100_000,
          availableMicros: 2_100_000,
          weightedUnitCostMinor: 0,
        }}
      />,
    );

    expect(html).toContain('On Hand');
    expect(html).toContain('Reserved');
    expect(html).toContain('Available');
    expect(html).toContain('3.2 kg');
    expect(html).toContain('1.1 kg');
    expect(html).toContain('2.1 kg');
  });
});

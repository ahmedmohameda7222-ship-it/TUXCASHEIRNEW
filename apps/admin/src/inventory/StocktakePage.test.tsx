import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StocktakePage } from './StocktakePage';

describe('StocktakePage', () => {
  it('does not present the frozen snapshot delta as the final posted adjustment', () => {
    const html = renderToStaticMarkup(
      <StocktakePage
        items={[
          {
            id: 'inventory-beef',
            name: 'Beef',
            unitLabel: 'kg',
            trackingMode: 'RECIPE_TRACKED',
            active: true,
            onHandMicros: 8_000_000,
            reservedMicros: 0,
            availableMicros: 8_000_000,
            weightedUnitCostMinor: 100,
            history: [],
          },
        ]}
        snapshot={{
          stocktakeId: 'stocktake-1',
          lines: [
            {
              inventoryItemId: 'inventory-beef',
              snapshotOnHandMicros: 10_000_000,
              snapshotReservedMicros: 0,
              unitCostMinor: 100,
            },
          ],
        }}
        pending={false}
        onBack={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain('Count vs snapshot');
    expect(html).toContain('Snapshot comparison only');
    expect(html).toContain('Final posted adjustment uses live on-hand at posting');
    expect(html).not.toContain('Quantity variance');
  });
});

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
            definitionVersion: 1,
            lowStockThresholdMicros: null,
            conversions: [],
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

    expect(html).toContain('Difference');
    expect(html).toContain('Expected stock');
    expect(html).toContain('Current stock movements remain preserved');
    expect(html).not.toContain('Quantity variance');
  });
});

describe('off-shift persisted stocktake controls', () => {
  it('exposes real save draft and abandon actions without posting inventory', () => {
    const html = renderToStaticMarkup(
      <StocktakePage
        items={[{
          id: 'inventory-beef', name: 'Beef', unitLabel: 'kg',
          trackingMode: 'RECIPE_TRACKED', definitionVersion: 1,
          lowStockThresholdMicros: null, conversions: [], active: true,
          onHandMicros: 8_000_000, reservedMicros: 0, availableMicros: 8_000_000,
          weightedUnitCostMinor: 100, history: [],
        }]}
        snapshot={{ stocktakeId: 'stocktake-1', lines: [{
          inventoryItemId: 'inventory-beef', snapshotOnHandMicros: 8_000_000,
          snapshotReservedMicros: 0, unitCostMinor: 100,
        }] }}
        pending={false}
        saving={false}
        stale={false}
        onBack={() => undefined}
        onSubmit={() => undefined}
        onSaveDraft={() => undefined}
        onCancelDraft={() => undefined}
      />,
    );
    expect(html).toContain('Save draft');
    expect(html).toContain('Cancel count');
    expect(html).toContain('Post stock count');
  });

  it('marks a stale recovered snapshot as unpostable', () => {
    const html = renderToStaticMarkup(
      <StocktakePage items={[]} snapshot={{ stocktakeId: 'stale', lines: [] }}
        pending={false} saving={false} stale={true}
        onBack={() => undefined} onSubmit={() => undefined}
        onSaveDraft={() => undefined} onCancelDraft={() => undefined} />,
    );
    expect(html).toContain('changed since the physical count began');
    expect(html).toContain('disabled');
  });
});

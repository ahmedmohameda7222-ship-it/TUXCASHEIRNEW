import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VarianceReport } from './VarianceReport';

describe('VarianceReport', () => {
  it('shows actual/theoretical usage and food-cost contributors', () => {
    const html = renderToStaticMarkup(
      <VarianceReport
        usage={[
          {
            inventoryItemId: 'beef',
            itemName: 'Beef',
            unitLabel: 'kg',
            actualUsageMicros: 12_000_000,
            theoreticalUsageMicros: 10_000_000,
            varianceMicros: 2_000_000,
            variancePercent: 20,
          },
        ]}
        margins={[
          {
            productId: 'burger',
            productName: 'Burger',
            sellingPriceMinor: 10_000,
            recipeCostMinor: 3_500,
            currentCostPercent: 35,
            targetCostPercent: 30,
            overTargetPercentagePoints: 5,
            alert: true,
            contributors: [
              {
                inventoryItemId: 'beef',
                name: 'Beef',
                costMinor: 2_400,
                sharePercent: 68.57,
              },
              {
                inventoryItemId: 'bun',
                name: 'Bun',
                costMinor: 700,
                sharePercent: 20,
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain('Actual vs theoretical usage');
    expect(html).toContain('Actual 12 kg');
    expect(html).toContain('Theoretical 10 kg');
    expect(html).toContain('2 kg');
    expect(html).toContain('20% variance');
    expect(html).toContain('Food cost 35%');
    expect(html).toContain('Target 30%');
    expect(html).toContain('Margin alert');
    expect(html).toContain('Beef 68.57%');
    expect(html).toContain('Bun 20%');
  });
});

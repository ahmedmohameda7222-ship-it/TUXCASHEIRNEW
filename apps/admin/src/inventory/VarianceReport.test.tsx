import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VarianceReport } from './VarianceReport';

describe('VarianceReport', () => {
  it('shows same-period actual versus theoretical usage and food-cost margin alerts', () => {
    const html = renderToStaticMarkup(
      <VarianceReport
        periodLabel="Last 30 days"
        variances={[
          {
            inventoryItemId: 'item-1',
            itemName: 'Beef',
            unitLabel: 'kg',
            actualUsageMicros: 12_000_000,
            theoreticalUsageMicros: 10_000_000,
            varianceMicros: 2_000_000,
            variancePercent: 20,
          },
        ]}
        marginAlerts={[
          {
            productId: 'product-1',
            productName: 'Burger',
            productPriceMinor: 20_000,
            recipeCostMinor: 7_200,
            foodCostPercent: 36,
            targetFoodCostPercent: 30,
            alertThresholdPercent: 35,
            alert: true,
            largestContributor: {
              inventoryItemId: 'item-1',
              itemName: 'Beef',
              costMinor: 5_000,
            },
          },
        ]}
        onBack={() => undefined}
      />,
    );

    expect(html).toContain('Last 30 days');
    expect(html).toContain('12 kg');
    expect(html).toContain('10 kg');
    expect(html).toContain('+2 kg');
    expect(html).toContain('+20%');
    expect(html).toContain('36% food cost');
    expect(html).toContain('Beef');
  });
});

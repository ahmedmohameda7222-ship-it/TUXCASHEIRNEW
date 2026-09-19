import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VarianceReport } from './VarianceReport';

describe('VarianceReport', () => {
  it('shows same-period actual versus theoretical usage and food-cost margin alerts', () => {
    render(
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

    expect(screen.getByText('Last 30 days')).toBeTruthy();
    expect(screen.getByText('12 kg')).toBeTruthy();
    expect(screen.getByText('10 kg')).toBeTruthy();
    expect(screen.getByText('+2 kg')).toBeTruthy();
    expect(screen.getByText('+20%')).toBeTruthy();
    expect(screen.getByText(/36% food cost/i)).toBeTruthy();
    expect(screen.getByText(/Beef/i)).toBeTruthy();
  });
});

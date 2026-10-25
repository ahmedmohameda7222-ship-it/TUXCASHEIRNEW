import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TransferPage } from './TransferPage';

const items = [
  {
    id: 'source',
    name: 'Beef',
    active: true,
    unitLabel: 'kg',
    trackingMode: 'RECIPE_TRACKED',
    onHandMicros: 4_000_000,
    reservedMicros: 1_000_000,
    availableMicros: 3_000_000,
    weightedUnitCostMinor: 12000,
    definitionVersion: 1,
    lowStockThresholdMicros: null,
    conversions: [],
    history: [],
  },
];

describe('Inventory transfer review and recovery', () => {
  it('requires explicit draft line staging and review before Send', () => {
    const html = renderToStaticMarkup(
      <TransferPage
        shopId="s1"
        shops={[
          { id: 's1', name: 'North' },
          { id: 's2', name: 'South' },
        ]}
        items={items}
        transfers={[]}
        sending={false}
        receiving={false}
        cancelling={false}
        onBack={vi.fn()}
        onSend={vi.fn()}
        onReceive={vi.fn()}
        onCancelTransfer={vi.fn()}
      />,
    );
    expect(html).toContain('Add to transfer');
    expect(html).toContain('Review transfer');
    expect(html).toContain('master');
  });

  it('shows a separate cancel affordance only for SENT outgoing stock', () => {
    const html = renderToStaticMarkup(
      <TransferPage
        shopId="s1"
        shops={[
          { id: 's1', name: 'North' },
          { id: 's2', name: 'South' },
        ]}
        items={items}
        transfers={[
          {
            id: 'tx1',
            sourceShopId: 's1',
            destinationShopId: 's2',
            status: 'SENT',
            sentAt: '2026-10-25T12:00:00Z',
            receivedAt: null,
            lines: [
              {
                inventoryItemId: 'source',
                itemName: 'Beef',
                unitLabel: 'kg',
                quantityMicros: 1_000_000,
              },
            ],
          },
        ]}
        sending={false}
        receiving={false}
        cancelling={false}
        onBack={vi.fn()}
        onSend={vi.fn()}
        onReceive={vi.fn()}
        onCancelTransfer={vi.fn()}
      />,
    );
    expect(html).toContain('Cancel sent transfer');
    expect(html).not.toContain('Receive transfer');
  });
});

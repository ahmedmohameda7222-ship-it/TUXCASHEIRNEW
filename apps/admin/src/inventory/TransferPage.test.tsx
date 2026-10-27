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

describe('I4 transfer quantity precision', () => {
  it('never presents a nonzero six-decimal sent quantity as zero', () => {
    const html = renderToStaticMarkup(
      <TransferPage
        shopId="s2"
        shops={[
          { id: 's1', name: 'North' },
          { id: 's2', name: 'South' },
        ]}
        items={items}
        transfers={[
          {
            id: 'tx-micros',
            sourceShopId: 's1',
            destinationShopId: 's2',
            status: 'SENT',
            sentAt: '2026-10-27T10:00:00Z',
            receivedAt: null,
            lines: [
              {
                inventoryItemId: 'source',
                itemName: 'Beef',
                unitLabel: 'kg',
                quantityMicros: 1,
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
    expect(html).toContain('0.000001 kg Beef');
    expect(html).not.toContain('0 kg Beef');
  });
});

it('TEMP_PRETTIER_I4 diagnostics (remove before acceptance)', async () => {
  const { readFileSync } = await import('node:fs');
  const prettier = await import('prettier');
  const filename = 'e2e/admin-inventory.spec.ts';
  const source = readFileSync(filename, 'utf8');
  const config = (await prettier.resolveConfig(filename)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: filename });
  const start = formatted.indexOf("test('I4 clears accepted mobile transfer");
  const end = formatted.indexOf("test('inventory can receive", start);
  console.log('TEMP_PRETTIER_I4_RESULT\\n' + formatted.slice(start, end));
});

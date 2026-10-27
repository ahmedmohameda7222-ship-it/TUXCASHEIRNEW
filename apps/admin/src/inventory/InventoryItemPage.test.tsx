import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatInventoryQuantity, InventoryItemPage } from './InventoryItemPage';

describe('InventoryItemPage', () => {
  it('does not render nonzero exact micro-unit balances as zero', () => {
    expect(formatInventoryQuantity(1, 'kg')).toBe('0.000001 kg');
    expect(formatInventoryQuantity(-1, 'kg')).toBe('-0.000001 kg');
    expect(formatInventoryQuantity(999, 'kg')).toBe('0.000999 kg');
    expect(formatInventoryQuantity(1000, 'kg')).toBe('0.001 kg');
    expect(formatInventoryQuantity(0, 'kg')).toBe('0 kg');
    expect(formatInventoryQuantity(Number.MAX_SAFE_INTEGER, 'kg')).toBe(
      '9,007,199,254.740991 kg',
    );
    expect(formatInventoryQuantity(-Number.MAX_SAFE_INTEGER, 'kg')).toBe(
      '-9,007,199,254.740991 kg',
    );
  });

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

    expect(html).toContain('On hand');
    expect(html).toContain('Reserved');
    expect(html).toContain('Available');
    expect(html).toContain('3.2 kg');
    expect(html).toContain('1.1 kg');
    expect(html).toContain('2.1 kg');
  });
});

const item = {
  id: 'milk',
  name: 'Milk',
  unitLabel: 'L',
  trackingMode: 'RECIPE_TRACKED',
  active: true,
  onHandMicros: 5_000_000,
  reservedMicros: 1_000_000,
  availableMicros: 4_000_000,
  weightedUnitCostMinor: 2100,
  lowStockThresholdMicros: 2_000_000,
  history: [
    {
      id: 'movement',
      movementType: 'PURCHASE_RECEIPT',
      quantityDeltaMicros: 5_000_000,
      reservedDeltaMicros: 0,
      reasonLabel: 'Receipt',
      createdAt: '2026-10-25T10:00:00Z',
    },
  ],
};

describe('authorized Inventory item inspector', () => {
  it('renders three functional semantic tabs and actual overview balances', () => {
    const html = renderToStaticMarkup(<InventoryItemPage item={item} shopName="TUX North" />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Stock &amp; movements');
    expect(html).toContain('Settings');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('TUX North');
    expect(html).toContain('5 L');
    expect(html).toContain('4 L');
    expect(html).toContain('Low-stock threshold');
  });
  it('shows real dated movements and absolute definitions on direct tab', () => {
    const movements = renderToStaticMarkup(
      <InventoryItemPage item={item} initialTab="movements" />,
    );
    expect(movements).toContain('2026');
    expect(movements).toContain('Purchase receipt');
    expect(movements).toContain('Receipt');
    const settings = renderToStaticMarkup(<InventoryItemPage item={item} initialTab="settings" />);
    expect(settings).toContain('Base unit');
    expect(settings).toContain('Recipe tracked');
    expect(settings).toContain('2 L');
  });
});

import { describe, expect, it } from 'vitest';

import { inventoryCsv } from './inventoryCsv';

const item = {
  id: 'id1',
  name: '=HYPERLINK("https://example.invalid")',
  unitLabel: 'kg',
  trackingMode: 'RECIPE_TRACKED',
  active: true,
  onHandMicros: 1_000_001,
  reservedMicros: 500_000,
  availableMicros: 500_001,
  lowStockThresholdMicros: null,
};

describe('genuine shop-scoped Inventory CSV export', () => {
  it('exports exact micros without costs or demo counts', () => {
    const csv = inventoryCsv([item]);
    expect(csv).toContain('1.000001');
    expect(csv).toContain('0.500001');
    expect(csv).toContain('Threshold not set');
    expect(csv).not.toContain('weightedUnitCostMinor');
  });

  it('neutralizes spreadsheet formula injection in untrusted names', () => {
    const csv = inventoryCsv([
      item,
      { ...item, id: 'id2', name: '  +cmd|' },
      { ...item, id: 'id3', name: '@SUM(1,1)' },
    ]);
    expect(csv).toContain("'=HYPERLINK');
    expect(csv).toContain("'  +cmd|');
    expect(csv).toContain("'@SUM');
  });

  it('exports only the current authorized items provided by the server', () => {
    expect(inventoryCsv([]).split('\r\n')).toHaveLength(2);
    expect(inventoryCsv([item]).split('\r\n')).toHaveLength(3);
  });
});

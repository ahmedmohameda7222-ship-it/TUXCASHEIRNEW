import type { AdminPurchaseOrder, AdminPurchasingInventoryItem } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DraftPurchaseOrderLinesEditor } from './DraftPurchaseOrderLinesEditor';

const item: AdminPurchasingInventoryItem = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Beef',
  unitLabel: 'kg',
  purchaseUnits: [{ label: 'case', baseMicrosPerPurchaseUnit: 1_000_000 }],
};

function orderForCost(costMinor: number): AdminPurchaseOrder {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    shopId: '44444444-4444-4444-8444-444444444444',
    supplierId: '55555555-5555-4555-8555-555555555555',
    supplierName: 'Supplier',
    status: 'DRAFT',
    reference: null,
    expectedDeliveryDate: null,
    version: 1,
    orderedAt: null,
    createdAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:00:00Z',
    lines: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        inventoryItemId: item.id,
        itemName: item.name,
        unitLabel: item.unitLabel,
        purchaseUnitLabel: 'case',
        baseMicrosPerPurchaseUnit: 1_000_000,
        orderedPurchaseUnitsMicros: 1_000_000,
        receivedPurchaseUnitsMicros: 0,
        returnedPurchaseUnitsMicros: 0,
        orderedBaseMicros: 1_000_000,
        receivedBaseMicros: 0,
        returnedBaseMicros: 0,
        remainingBaseMicros: 1_000_000,
        expectedPurchaseUnitCostMinor: costMinor,
        expectedUnitCostMinor: costMinor,
      },
    ],
  };
}

describe('P2 existing purchase-order draft line editing', () => {
  it('rehydrates the highest safe persisted minor-unit cost without multiplication overflow', () => {
    const html = renderToStaticMarkup(
      <DraftPurchaseOrderLinesEditor
        order={orderForCost(Number.MAX_SAFE_INTEGER)}
        inventoryItems={[item]}
        pending={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('value="90071992547409.91"');
    expect(html).not.toContain('90071992547409.92');
  });
});

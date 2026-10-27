import type { AdminPurchaseOrder } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ReceivePurchasePage } from './ReceivePurchasePage';

const order: AdminPurchaseOrder = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  shopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  supplierId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  supplierName: 'Supplier',
  reference: 'PO-100',
  status: 'PARTIALLY_RECEIVED',
  version: 2,
  createdAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:00:00Z',
  orderedAt: '2026-10-27T10:00:00Z',
  expectedDeliveryDate: null,
  lines: [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      inventoryItemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      itemName: 'Beef',
      unitLabel: 'kg',
      purchaseUnitLabel: 'case',
      baseMicrosPerPurchaseUnit: 2_000_000,
      orderedPurchaseUnitsMicros: 5_000_000,
      receivedPurchaseUnitsMicros: 2_000_001,
      returnedPurchaseUnitsMicros: 500_000,
      orderedBaseMicros: 10_000_000,
      receivedBaseMicros: 4_000_002,
      returnedBaseMicros: 1_000_000,
      remainingBaseMicros: 5_999_998,
      expectedPurchaseUnitCostMinor: 25_000,
      expectedUnitCostMinor: 12_500,
    },
  ],
};

function render(mode: 'receive' | 'return') {
  return renderToStaticMarkup(
    <ReceivePurchasePage
      order={order}
      mode={mode}
      pending={false}
      onCancel={vi.fn()}
      onReceive={vi.fn()}
      onReturn={vi.fn()}
    />,
  );
}

describe('P3 exact purchase movement line balances', () => {
  it('shows ordered, already received and maximum receipt quantities at one-micro precision', () => {
    const html = render('receive');
    expect(html).toContain('Ordered: 5 case');
    expect(html).toContain('Already received: 2.000001 case');
    expect(html).toContain('Maximum remaining: 2.999999 case');
  });

  it('shows received, already returned and maximum allowable supplier return', () => {
    const html = render('return');
    expect(html).toContain('Already received: 2.000001 case');
    expect(html).toContain('Already returned: 0.5 case');
    expect(html).toContain('Maximum returnable: 1.500001 case');
  });
});

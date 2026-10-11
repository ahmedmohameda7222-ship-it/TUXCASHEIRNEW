import type { AdminPurchaseOrder } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseOrderPage } from './PurchaseOrderPage';

const order: AdminPurchaseOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  supplierId: '33333333-3333-4333-8333-333333333333',
  supplierName: 'Local Supplier',
  reference: 'PO-123',
  expectedDeliveryDate: '2026-10-15',
  status: 'DRAFT',
  version: 2,
  orderedAt: null,
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z',
  lines: [],
};

function render(status: AdminPurchaseOrder['status'], canManage = true) {
  return renderToStaticMarkup(
    <PurchaseOrderPage
      order={{ ...order, status }}
      canManage={canManage}
      canReceive={false}
      ordering={false}
      updating={false}
      onUpdate={vi.fn()}
      onOrder={vi.fn()}
      onReceive={vi.fn()}
      onReturn={vi.fn()}
    />,
  );
}

describe('purchase order draft metadata editor', () => {
  it('exposes draft editing to purchasing managers', () => {
    expect(render('DRAFT')).toContain('Edit draft');
  });

  it('never exposes draft editing once ordered or to read-only staff', () => {
    expect(render('ORDERED')).not.toContain('Edit draft');
    expect(render('PARTIALLY_RECEIVED')).not.toContain('Edit draft');
    expect(render('DRAFT', false)).not.toContain('Edit draft');
  });
});

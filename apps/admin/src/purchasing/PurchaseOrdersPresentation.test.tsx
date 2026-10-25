import type { AdminPurchaseOrder, AdminSupplier } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseOrdersPage } from './PurchaseOrdersPage';

const supplier: AdminSupplier = {
  id: 'supplier-1',
  businessId: 'business-1',
  name: 'Alpha Foods',
  contactName: 'Contact',
  phone: null,
  email: null,
  active: true,
  version: 1,
};

const order: AdminPurchaseOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: 'shop-1',
  supplierId: supplier.id,
  supplierName: supplier.name,
  reference: null,
  expectedDeliveryDate: '2026-10-31',
  status: 'ORDERED',
  version: 1,
  orderedAt: '2026-10-25T12:00:00Z',
  createdAt: '2026-10-24T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
  lines: [],
};

function render(orders: readonly AdminPurchaseOrder[]) {
  return renderToStaticMarkup(
    <PurchaseOrdersPage
      purchaseOrders={orders}
      suppliers={[supplier]}
      inventoryItems={[]}
      selectedId={null}
      canManage
      pending={false}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
    />,
  );
}

describe('approved purchase order directory', () => {
  it('has accessible shop-workspace search, status, supplier and reset controls', () => {
    const html = render([order]);
    expect(html).toContain('Search purchase orders');
    expect(html).toContain('Filter by status');
    expect(html).toContain('Filter by supplier');
    expect(html).toContain('Reset filters');
  });

  it('displays purchase order reference, supplier, delivery and status without fake sample values', () => {
    const html = render([order]);
    expect(html).toContain('PO-11111111');
    expect(html).toContain('Alpha Foods');
    expect(html).toContain('2026-10-31');
    expect(html).toContain('Ordered');
    expect(html).not.toContain('EGP 3,440');
  });

  it('distinguishes empty shop data from search results', () => {
    expect(render([])).toContain('No purchase orders yet');
  });
});

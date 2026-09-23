import type { AdminOrderDetail, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CancelOrderSheet } from './CancelOrderSheet';
import { RefundReturnPage } from './RefundReturnPage';
import { buildOrderSearchUrl } from './useOrders';

const cancellationReason: AdminReasonCodeConfiguration = {
  id: '10000000-0000-4000-8000-000000000001',
  scope: 'BUSINESS',
  key: 'CUSTOMER_REQUEST',
  family: 'CANCELLATION',
  label: 'Customer request',
  active: true,
  version: 3,
};

const refundReason: AdminReasonCodeConfiguration = {
  ...cancellationReason,
  id: '10000000-0000-4000-8000-000000000002',
  key: 'QUALITY_ISSUE',
  family: 'REFUND_RETURN',
  label: 'Quality issue',
};

const order: AdminOrderDetail = {
  id: '20000000-0000-4000-8000-000000000001',
  shopId: '20000000-0000-4000-8000-000000000002',
  status: 'DONE',
  operationalRevision: 7,
  source: 'POS',
  displayOrderNo: 42,
  displayOrderLabel: '#42',
  createdAt: '2026-09-22T18:00:00.000Z',
  totalMinor: 12500,
  customer: null,
  fulfillment: null,
  payments: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      methodLabel: 'Cash',
      logicType: 'CASH',
      allocatedMinor: 12500,
      receivedMinor: 12500,
      changeMinor: 0,
    },
  ],
  items: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      productId: '40000000-0000-4000-8000-000000000002',
      productName: 'TUX Burger',
      quantity: 2,
      unitPriceMinor: 6250,
      itemNote: null,
      modifiers: [],
      comboBeverages: [],
    },
  ],
  statusHistory: [],
  inventoryMovements: [],
  auditEvents: [],
};

describe('Orders Task 2 controls', () => {
  it('mounts the real OrdersPage at /orders', async () => {
    const source = await readFile(resolve('apps/admin/src/app/routes.tsx'), 'utf8');
    expect(source).toContain("import { OrdersPage } from '../orders/OrdersPage';");
    expect(source).toContain("if (route.path === '/orders') return <OrdersPage />;");
  });

  it('builds shop-scoped search filters for the trusted Orders BFF', () => {
    const url = buildOrderSearchUrl({
      shopId: 'shop-a',
      query: 'Mona',
      statuses: ['ACTIVE', 'DONE'],
      source: 'POS',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-22T23:59:59.999Z',
      cursor: null,
      limit: 50,
    });
    expect(url).toContain('/api/admin/orders?');
    expect(url).toContain('shopId=shop-a');
    expect(url).toContain('q=Mona');
    expect(url).toContain('status=ACTIVE');
    expect(url).toContain('status=DONE');
    expect(url).toContain('source=POS');
    expect(url).toContain('from=2026-09-01T00%3A00%3A00.000Z');
  });

  it('uses configured cancellation reasons and requires acting-user re-PIN input', () => {
    const html = renderToStaticMarkup(
      <CancelOrderSheet
        reasons={[cancellationReason]}
        pending={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(html).toContain('Customer request');
    expect(html).toContain('Admin PIN');
    expect(html).toContain('Confirm cancellation');
  });

  it('keeps refund and item-return actions separate and reason coded', () => {
    const html = renderToStaticMarkup(
      <RefundReturnPage
        order={order}
        reasons={[refundReason]}
        refunding={false}
        returning={false}
        onCancel={vi.fn()}
        onRefund={vi.fn()}
        onReturn={vi.fn()}
      />,
    );
    expect(html).toContain('Quality issue');
    expect(html).toContain('Cash');
    expect(html).toContain('TUX Burger');
    expect(html).toContain('Admin PIN');
    expect(html).toContain('Submit refund');
    expect(html).toContain('Return selected items');
  });
});

import type { AdminOrderDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OrderDetailPage } from './OrderDetailPage';

const fixture: AdminOrderDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  status: 'ACTIVE',
  operationalRevision: 4,
  source: 'POS',
  displayOrderNo: 42,
  displayOrderLabel: '#42',
  createdAt: '2026-09-21T03:00:00.000Z',
  totalMinor: 12500,
  customer: {
    contactId: '33333333-3333-4333-8333-333333333333',
    name: 'Mona',
    normalizedPhone: '+201000000000',
  },
  fulfillment: {
    orderTypeLabel: 'Delivery',
    behavior: 'DELIVERY',
    address: 'Road 9, Maadi',
    deliveryZoneLabel: 'Maadi',
    finalDeliveryFeeMinor: 1500,
  },
  payments: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      methodLabel: 'Cash',
      logicType: 'CASH',
      allocatedMinor: 12500,
      receivedMinor: 15000,
      changeMinor: 2500,
    },
  ],
  items: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      productId: '66666666-6666-4666-8666-666666666666',
      productName: 'TUX Burger',
      quantity: 1,
      unitPriceMinor: 11000,
      itemNote: 'No onions',
      modifiers: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          label: 'Extra cheese',
          quantity: 1,
          unitPriceMinor: 500,
        },
      ],
      comboBeverages: [
        {
          productId: '88888888-8888-4888-8888-888888888888',
          label: 'Cola',
        },
      ],
    },
  ],
  statusHistory: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      eventType: 'PLACED',
      operationalRevision: 0,
      fromStatus: null,
      toStatus: 'ACTIVE',
      workerName: 'Ahmed',
      adminEmployeeId: null,
      reason: null,
      note: null,
      createdAt: '2026-09-21T03:00:00.000Z',
    },
  ],
  inventoryMovements: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      inventoryItemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      movementType: 'ORDER_RESERVATION',
      quantityDeltaMicros: 0,
      reservedDeltaMicros: 1_000_000,
      createdAt: '2026-09-21T03:00:00.000Z',
    },
  ],
  auditEvents: [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      actionType: 'ORDER_VIEWED',
      actorEmployeeId: null,
      createdAt: '2026-09-21T03:01:00.000Z',
    },
  ],
};

function render(order: AdminOrderDetail): string {
  return renderToStaticMarkup(
    <OrderDetailPage
      order={order}
      canCancel
      canRefund
      cancelling={false}
      refunding={false}
      returning={false}
      onCancel={vi.fn()}
      onRefund={vi.fn()}
      onReturn={vi.fn()}
    />,
  );
}

describe('OrderDetailPage', () => {
  it('offers cancel for ACTIVE and refund / return for DONE', () => {
    expect(render({ ...fixture, status: 'ACTIVE' })).toContain('Cancel order');
    const done = render({ ...fixture, status: 'DONE' });
    expect(done).toContain('Refund / return');
    expect(done).not.toContain('Cancel order');
  });

  it('renders immutable order context needed to investigate a lifecycle action', () => {
    const html = render(fixture);

    for (const value of [
      'TUX Burger',
      'Extra cheese',
      'Cola',
      'Mona',
      '+201000000000',
      'Road 9, Maadi',
      'Cash',
      'ORDER RESERVATION',
      'PLACED',
      'Ahmed',
      'ORDER VIEWED',
    ]) {
      expect(html).toContain(value);
    }
  });
});

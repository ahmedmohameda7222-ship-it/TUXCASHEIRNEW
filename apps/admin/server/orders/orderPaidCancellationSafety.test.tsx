import type { AdminOrderDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { classifyPaidOrderCancellationDatabaseError } from '../../api/admin/orders';
import { OrderDetailPage } from '../../src/orders/OrderDetailPage';

function order(paid: boolean): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    shopId: '22222222-2222-4222-8222-222222222222',
    status: 'ACTIVE',
    operationalRevision: 0,
    source: 'POS',
    displayOrderNo: 1,
    displayOrderLabel: '#1',
    createdAt: '2026-10-25T08:00:00.000Z',
    totalMinor: 10000,
    customer: null,
    fulfillment: null,
    payments: paid ? [{
      id: '33333333-3333-4333-8333-333333333333',
      methodLabel: 'Cash',
      logicType: 'CASH',
      allocatedMinor: 10000,
      receivedMinor: 10000,
      changeMinor: 0,
    }] : [],
    items: [],
    statusHistory: [],
    financialEvents: [],
    inventoryMovements: [],
    auditEvents: [],
  };
}

function render(paid: boolean) {
  return renderToStaticMarkup(<OrderDetailPage
    order={order(paid)}
    canCancel
    canRefund
    cancelling={false}
    refunding={false}
    returning={false}
    onCancel={vi.fn()}
    onRefund={vi.fn()}
    onReturn={vi.fn()}
  />);
}

describe('paid ACTIVE cancellation financial safety', () => {
  it('does not offer unsafe Admin cancellation when a payment is allocated', () => {
    const html = render(true);
    expect(html).not.toContain('Cancel order</button>');
    expect(html).toContain('Paid active order');
    expect(html).toContain('refund');
  });

  it('allows existing unpaid cancellation path', () => {
    expect(render(false)).toContain('Cancel order</button>');
  });

  it('maps authoritative paid cancellation refusal to a stable conflict', () => {
    expect(classifyPaidOrderCancellationDatabaseError(
      '{"message":"TUX_ADMIN_PAID_CANCEL_REQUIRES_SETTLEMENT"}',
    )).toEqual({ status: 409, error: 'paid_active_cancellation_requires_settlement' });
  });
});

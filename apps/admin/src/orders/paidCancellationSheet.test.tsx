import type { AdminOrderDetail, AdminReasonCodeConfiguration } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CancelOrderSheet } from './CancelOrderSheet';

const reasons: AdminReasonCodeConfiguration[] = [{
  id: '10000000-0000-4000-8000-000000000001',
  scope: 'BUSINESS', key: 'CUSTOMER_REQUEST', family: 'CANCELLATION',
  label: 'Customer request', active: true, version: 1,
}];
const order: AdminOrderDetail = {
  id: '20000000-0000-4000-8000-000000000001',
  shopId: '30000000-0000-4000-8000-000000000001',
  status: 'ACTIVE', operationalRevision: 2, source: 'POS',
  displayOrderNo: 1, displayOrderLabel: '#1',
  createdAt: '2026-10-25T09:00:00Z', totalMinor: 12000,
  customer: null, fulfillment: null, items: [], statusHistory: [],
  financialEvents: [], inventoryMovements: [], auditEvents: [],
  payments: [{ id: '40000000-0000-4000-8000-000000000001',
    methodLabel: 'Cash', logicType: 'CASH', allocatedMinor: 5000,
    receivedMinor: 5000, changeMinor: 0, refundAllowedSnapshot: true,
    postedRefundMinor: 1000, pendingRefundMinor: 2000, remainingRefundableMinor: 2000 }],
};
function render(detail: AdminOrderDetail) {
  return renderToStaticMarkup(<CancelOrderSheet reasons={reasons} order={detail}
    pending={false} onCancel={vi.fn()} onSubmit={vi.fn()} />);
}
describe('Orders paid cancellation disclosure', () => {
  it('blocks partial and fully paid ACTIVE cancellations and explains unrefunded liability', () => {
    const html = render(order);
    expect(html).toContain('Cash');
    expect(html).toContain('Recorded payments');
    expect(html).toContain('Previously posted refunds');
    expect(html).toContain('Remaining refundable amount');
    expect(html).toContain('cannot cancel');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm cancellation<\/button>/);
  });
  it('preserves unpaid ACTIVE cancellation with reservation consequences visible', () => {
    const html = render({ ...order, payments: [] });
    expect(html).toContain('Inventory');
    expect(html).toContain('Confirm cancellation');
    expect(html).not.toContain('cannot cancel');
  });
});

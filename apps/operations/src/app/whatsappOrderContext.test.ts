import type { WhatsAppCustomerOrderContext } from '@tux/application';
import type { OrderId } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import { presentWhatsAppOrderContext } from './whatsappOrderContext';

const ORDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrderId;
const ORDER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrderId;

const customer = {
  normalizedPhone: '+201001234567',
  displayPhone: '010 0123 4567',
  customerName: 'Mona',
  address: 'Nasr City',
  zoneId: null,
};

function order(id: OrderId, displayOrderNo: number) {
  return {
    id,
    displayOrderNo,
    status: 'ACTIVE' as const,
    orderTypeLabel: 'Delivery',
    createdAt: '2026-09-04T10:00:00.000Z' as const,
  };
}

describe('presentWhatsAppOrderContext', () => {
  it('presents customer-only context without inventing an active order', () => {
    const context: WhatsAppCustomerOrderContext = {
      kind: 'NO_ACTIVE_ORDER',
      customer,
      activeOrders: [],
    };

    expect(presentWhatsAppOrderContext(context, null)).toEqual({
      customerName: 'Mona',
      displayPhone: '010 0123 4567',
      address: 'Nasr City',
      activeOrderCount: 0,
      primaryOrder: null,
      candidates: [],
    });
  });

  it('uses the human order number for one active order and exposes its explicit linked state', () => {
    const context: WhatsAppCustomerOrderContext = {
      kind: 'ONE_ACTIVE_ORDER',
      customer,
      activeOrders: [order(ORDER_A, 184)],
    };

    expect(presentWhatsAppOrderContext(context, ORDER_A).primaryOrder).toEqual({
      id: ORDER_A,
      displayLabel: 'Order #184',
      orderTypeLabel: 'Delivery',
      linked: true,
    });
  });

  it('renders every multiple-order candidate and never chooses a primary order', () => {
    const context: WhatsAppCustomerOrderContext = {
      kind: 'MULTIPLE_ACTIVE_ORDERS',
      customer,
      activeOrders: [order(ORDER_A, 184), order(ORDER_B, 191)],
    };

    const presentation = presentWhatsAppOrderContext(context, ORDER_B);

    expect(presentation.primaryOrder).toBeNull();
    expect(presentation.candidates).toEqual([
      { id: ORDER_A, displayLabel: 'Order #184', orderTypeLabel: 'Delivery', linked: false },
      { id: ORDER_B, displayLabel: 'Order #191', orderTypeLabel: 'Delivery', linked: true },
    ]);
    expect(presentation.candidates.map((candidate) => candidate.displayLabel)).not.toContain(
      String(ORDER_A),
    );
  });
});

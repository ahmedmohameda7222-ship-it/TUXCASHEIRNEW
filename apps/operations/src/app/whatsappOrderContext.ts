import type { WhatsAppCustomerOrderContext } from '@tux/application';
import type { OrderId } from '@tux/domain';

export interface WhatsAppOrderCandidatePresentation {
  readonly id: OrderId;
  readonly displayLabel: string;
  readonly orderTypeLabel: string;
  readonly linked: boolean;
}

export interface WhatsAppOrderContextPresentation {
  readonly customerName: string;
  readonly displayPhone: string;
  readonly address: string | null;
  readonly activeOrderCount: number;
  readonly primaryOrder: WhatsAppOrderCandidatePresentation | null;
  readonly candidates: readonly WhatsAppOrderCandidatePresentation[];
}

function presentOrder(
  order: WhatsAppCustomerOrderContext['activeOrders'][number],
  linkedOrderId: OrderId | null,
): WhatsAppOrderCandidatePresentation {
  return {
    id: order.id,
    displayLabel: `Order #${order.displayOrderNo}`,
    orderTypeLabel: order.orderTypeLabel,
    linked: order.id === linkedOrderId,
  };
}

export function presentWhatsAppOrderContext(
  context: WhatsAppCustomerOrderContext,
  linkedOrderId: OrderId | null,
): WhatsAppOrderContextPresentation {
  const candidates = context.activeOrders.map((order) => presentOrder(order, linkedOrderId));
  return {
    customerName: context.customer.customerName,
    displayPhone: context.customer.displayPhone,
    address: context.customer.address,
    activeOrderCount: candidates.length,
    primaryOrder: context.kind === 'ONE_ACTIVE_ORDER' ? (candidates[0] ?? null) : null,
    candidates,
  };
}

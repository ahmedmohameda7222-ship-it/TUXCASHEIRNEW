import {
  normalizeEgyptianPhone,
  type DeliveryZoneId,
  type Instant,
  type OrderId,
  type OrderSnapshot,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase, WhatsAppStore } from '@tux/persistence';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';
import type { OperationsSessionResult } from './session';

export interface WhatsAppCustomerContext {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string;
  readonly address: string | null;
  readonly zoneId: DeliveryZoneId | null;
}

export interface WhatsAppActiveOrderSummary {
  readonly id: OrderId;
  readonly displayOrderNo: number;
  readonly status: 'ACTIVE';
  readonly orderTypeLabel: string;
  readonly createdAt: Instant;
}

export type WhatsAppCustomerOrderContext =
  | {
      readonly kind: 'NO_ACTIVE_ORDER';
      readonly customer: WhatsAppCustomerContext;
      readonly activeOrders: readonly [];
    }
  | {
      readonly kind: 'ONE_ACTIVE_ORDER';
      readonly customer: WhatsAppCustomerContext;
      readonly activeOrders: readonly [WhatsAppActiveOrderSummary];
    }
  | {
      readonly kind: 'MULTIPLE_ACTIVE_ORDERS';
      readonly customer: WhatsAppCustomerContext;
      readonly activeOrders: readonly WhatsAppActiveOrderSummary[];
    };

export interface WhatsAppOrderContextSessionSource {
  getState(): Promise<OperationsSessionResult>;
}

function failure(
  code: ApplicationError['code'],
  message: string,
  cause?: unknown,
): ApplicationError {
  return cause === undefined ? { code, message } : { code, message, cause };
}

function compareOrders(
  left: WhatsAppActiveOrderSummary,
  right: WhatsAppActiveOrderSummary,
): number {
  const created = String(left.createdAt).localeCompare(String(right.createdAt));
  if (created !== 0) return created;
  const orderNo = left.displayOrderNo - right.displayOrderNo;
  if (orderNo !== 0) return orderNo;
  return String(left.id).localeCompare(String(right.id));
}

function summarizeMatchingOrder(
  order: OrderSnapshot,
  shopId: ShopId,
  normalizedPhone: string,
): WhatsAppActiveOrderSummary | null {
  if (
    order.shopId !== shopId ||
    order.status !== 'ACTIVE' ||
    order.fulfillment.behavior !== 'DELIVERY'
  ) {
    return null;
  }
  const phone = normalizeEgyptianPhone(order.fulfillment.delivery.normalizedPhone);
  if (!phone.valid || phone.normalizedPhone !== normalizedPhone) return null;
  return {
    id: order.id,
    displayOrderNo: order.displayOrderNo,
    status: 'ACTIVE',
    orderTypeLabel: order.fulfillment.orderTypeLabel,
    createdAt: order.createdAt,
  };
}

export async function resolveWhatsAppCustomerOrderContext(input: {
  readonly database: OperationsDatabase;
  readonly store: WhatsAppStore;
  readonly session: WhatsAppOrderContextSessionSource;
  readonly conversationId: string;
}): Promise<Result<WhatsAppCustomerOrderContext, ApplicationError>> {
  let session: OperationsSessionResult;
  try {
    session = await input.session.getState();
  } catch (cause) {
    return err(
      failure('LOCAL_PERSISTENCE_ERROR', 'Could not read the current Operations session.', cause),
    );
  }
  if (!session.ok) return session;
  if (session.value.status !== 'ACTIVE') {
    return err(
      failure(
        'CONFLICT_ERROR',
        'An active Current Operator is required to resolve WhatsApp order context.',
      ),
    );
  }

  const { shopId, businessDayId } = session.value;
  try {
    const snapshot = await input.store.loadInbox(shopId);
    const conversation = snapshot.conversations.find(
      (candidate) => candidate.id === input.conversationId && candidate.shopId === shopId,
    );
    if (conversation === undefined) {
      return err(
        failure(
          'VALIDATION_ERROR',
          'The WhatsApp conversation is not available for the current shop.',
        ),
      );
    }

    const phone = normalizeEgyptianPhone(
      conversation.normalizedPhone.trim().length > 0
        ? conversation.normalizedPhone
        : conversation.displayPhone,
    );
    if (!phone.valid) {
      return err(
        failure(
          'VALIDATION_ERROR',
          'The WhatsApp conversation does not contain a valid Egyptian phone.',
        ),
      );
    }

    const local = await input.database.transaction(async (transaction) => {
      const [contact, orders] = await Promise.all([
        transaction.customerContacts.getByNormalizedPhone(shopId, phone.normalizedPhone),
        transaction.orders.listByBusinessDay(businessDayId),
      ]);
      return { contact, orders };
    });

    const customer: WhatsAppCustomerContext = local.contact
      ? {
          normalizedPhone: phone.normalizedPhone,
          displayPhone: local.contact.displayPhone,
          customerName: local.contact.name,
          address: local.contact.latestAddress,
          zoneId: local.contact.latestZoneId,
        }
      : {
          normalizedPhone: phone.normalizedPhone,
          displayPhone: conversation.displayPhone,
          customerName: conversation.customerName?.trim() || conversation.displayPhone,
          address: null,
          zoneId: null,
        };

    const activeOrders = local.orders
      .map((order) => summarizeMatchingOrder(order, shopId, phone.normalizedPhone))
      .filter((order): order is WhatsAppActiveOrderSummary => order !== null)
      .sort(compareOrders);

    if (activeOrders.length === 0) {
      return ok({ kind: 'NO_ACTIVE_ORDER', customer, activeOrders: [] });
    }
    if (activeOrders.length === 1) {
      return ok({ kind: 'ONE_ACTIVE_ORDER', customer, activeOrders: [activeOrders[0]!] });
    }
    return ok({ kind: 'MULTIPLE_ACTIVE_ORDERS', customer, activeOrders });
  } catch (cause) {
    return err(
      failure(
        'LOCAL_PERSISTENCE_ERROR',
        'Could not resolve the local WhatsApp customer and order context.',
        cause,
      ),
    );
  }
}

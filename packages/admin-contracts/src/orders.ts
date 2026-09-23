export const ADMIN_ORDER_STATUSES = ['ACTIVE', 'DONE', 'CANCELLED', 'RETURNED'] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

export type AdminOrderSource = 'POS' | 'ONLINE';

export type AdminOrderSearchInput = {
  shopId: string;
  query?: string | null;
  statuses?: readonly AdminOrderStatus[];
  source?: AdminOrderSource | null;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  limit?: number;
};

export type AdminOrderSummary = {
  id: string;
  shopId: string;
  status: AdminOrderStatus;
  operationalRevision: number;
  source: AdminOrderSource;
  displayOrderNo: number;
  displayOrderLabel: string | null;
  createdAt: string;
  totalMinor: number;
  customerName: string | null;
  normalizedPhone: string | null;
  orderTypeLabel: string;
};

export type AdminOrderSearchResult = {
  shopId: string;
  rows: readonly AdminOrderSummary[];
  nextCursor: string | null;
};

export type AdminOrderReasonSnapshot = {
  id: string;
  key: string;
  label: string;
  family: 'CANCELLATION' | 'REFUND_RETURN' | 'DISCOUNT_COMP';
  configurationVersion: number;
};

export type AdminOrderPayment = {
  id: string;
  methodLabel: string;
  logicType: string;
  allocatedMinor: number;
  receivedMinor: number | null;
  changeMinor: number | null;
};

export type AdminOrderItemModifier = {
  id: string | null;
  label: string;
  quantity: number;
  unitPriceMinor: number;
};

export type AdminOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  itemNote: string | null;
  modifiers: readonly AdminOrderItemModifier[];
  comboBeverages: readonly { productId: string; label: string }[];
};

export type AdminOrderStatusEvent = {
  id: string;
  eventType: string;
  operationalRevision: number;
  fromStatus: AdminOrderStatus | null;
  toStatus: AdminOrderStatus;
  workerName: string | null;
  adminEmployeeId: string | null;
  reason: AdminOrderReasonSnapshot | null;
  note: string | null;
  createdAt: string;
};

export type AdminOrderDetail = {
  id: string;
  shopId: string;
  status: AdminOrderStatus;
  operationalRevision: number;
  source: AdminOrderSource;
  displayOrderNo: number;
  displayOrderLabel: string | null;
  createdAt: string;
  totalMinor: number;
  customer: {
    contactId: string | null;
    name: string | null;
    normalizedPhone: string | null;
  } | null;
  fulfillment: {
    orderTypeLabel: string;
    behavior: string;
    address: string | null;
    deliveryZoneLabel: string | null;
    finalDeliveryFeeMinor: number;
  } | null;
  payments: readonly AdminOrderPayment[];
  items: readonly AdminOrderItem[];
  statusHistory: readonly AdminOrderStatusEvent[];
  inventoryMovements: readonly {
    id: string;
    inventoryItemId: string;
    movementType: string;
    quantityDeltaMicros: number;
    reservedDeltaMicros: number;
    createdAt: string;
  }[];
  auditEvents: readonly {
    id: string;
    actionType: string;
    actorEmployeeId: string | null;
    createdAt: string;
  }[];
};

export type CancelAdminOrderInput = {
  shopId: string;
  orderId: string;
  expectedOperationalRevision: number;
  reasonCodeId: string;
  note: string | null;
  commandId: string;
};

export type RequestAdminRefundInput = {
  shopId: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  reasonCodeId: string;
  note: string | null;
  commandId: string;
};

export type ReturnAdminOrderItemsInput = {
  shopId: string;
  orderId: string;
  items: readonly { orderItemId: string; quantity: number }[];
  reasonCodeId: string;
  note: string | null;
  commandId: string;
};

export type AdminOrderCancellationResult =
  | {
      ok: true;
      orderId: string;
      status: 'CANCELLED';
      operationalRevision: number;
      lifecycleCursor?: number;
      replayed: boolean;
    }
  | {
      ok: false;
      code: string;
      canonicalStatus?: AdminOrderStatus;
      canonicalOperationalRevision?: number;
    };

export type AdminOrderFinancialMutationResult =
  | {
      ok: true;
      orderId: string;
      refundId?: string;
      returnId?: string;
      state: 'PENDING_APPROVAL' | 'POSTED';
      approvalRequestId?: string;
      replayed: boolean;
    }
  | { ok: false; code: string };

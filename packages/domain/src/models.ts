import type { BusinessDayId } from './businessDay';
import type {
  AuditEventId,
  CustomerContactId,
  DeliveryZoneId,
  DeviceId,
  ExpenseId,
  InventoryItemId,
  InventoryMovementId,
  ModifierId,
  OrderId,
  OrderItemId,
  OrderTypeId,
  OutboxEventId,
  PaymentId,
  PaymentMethodId,
  ProductId,
  ReconciliationId,
  ShopId,
  WorkerId,
  WorkerSessionId,
} from './ids';
import type { JsonValue } from './json';
import type { MoneyMinor } from './money';
import type { StockQuantityMicros } from './quantity';
import type { Instant } from './time';

export interface Shop {
  readonly id: ShopId;
  readonly name: string;
  readonly active: boolean;
}

export interface Device {
  readonly id: DeviceId;
  readonly shopId: ShopId;
  readonly label: string;
  readonly active: boolean;
}

export interface Worker {
  readonly id: WorkerId;
  readonly shopId: ShopId;
  readonly displayName: string;
  readonly active: boolean;
}

export type WorkerSession =
  | {
      readonly id: WorkerSessionId;
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly workerId: WorkerId;
      readonly startedAt: Instant;
      readonly endedAt: null;
    }
  | {
      readonly id: WorkerSessionId;
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly workerId: WorkerId;
      readonly startedAt: Instant;
      readonly endedAt: Instant;
    };

export type PaymentLogicType = 'CASH' | 'CARD' | 'DIGITAL' | 'OTHER';

export interface PaymentMethodSnapshot {
  readonly id: PaymentMethodId;
  readonly label: string;
  readonly logicType: PaymentLogicType;
}

export type CashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & { readonly logicType: 'CASH' };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: MoneyMinor;
  readonly changeMinor: MoneyMinor;
};

export type NonCashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & {
    readonly logicType: Exclude<PaymentLogicType, 'CASH'>;
  };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: null;
  readonly changeMinor: null;
};

export type PaymentPart = CashPaymentPart | NonCashPaymentPart;

export interface OrderModifierSnapshot {
  readonly modifierId: ModifierId;
  readonly label: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
}

export interface ComboBeverageSnapshot {
  readonly productId: ProductId;
  readonly label: string;
}

export interface OrderItemSnapshot {
  readonly id: OrderItemId;
  readonly productId: ProductId;
  readonly productName: string;
  readonly unitPriceMinor: MoneyMinor;
  readonly quantity: number;
  readonly modifiers: readonly OrderModifierSnapshot[];
  readonly comboBeverages: readonly ComboBeverageSnapshot[];
  readonly itemNote: string | null;
}

export type OrderTypeBehavior = 'TAKE_AWAY' | 'DINE_IN' | 'DELIVERY' | 'OTHER';

interface FulfillmentBase {
  readonly orderTypeId: OrderTypeId;
  readonly orderTypeLabel: string;
}

export type OrderFulfillmentSnapshot =
  | (FulfillmentBase & {
      readonly behavior: Exclude<OrderTypeBehavior, 'DELIVERY'>;
      readonly delivery: null;
    })
  | (FulfillmentBase & {
      readonly behavior: 'DELIVERY';
      readonly delivery: {
        readonly customerContactId: CustomerContactId | null;
        readonly customerName: string;
        readonly normalizedPhone: string;
        readonly address: string;
        readonly zoneId: DeliveryZoneId;
        readonly zoneLabel: string;
        readonly configuredFeeMinor: MoneyMinor;
        readonly finalFeeMinor: MoneyMinor;
      };
    });

export type OrderStatus = 'ACTIVE' | 'DONE' | 'CANCELLED' | 'RETURNED';
export type OrderSource = 'POS' | 'ONLINE';

export interface OrderSnapshot {
  readonly id: OrderId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly displayOrderNo: number;
  readonly idempotencyKey: string;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly operatorWorkerId: WorkerId;
  readonly operatorName: string;
  readonly createdAt: Instant;
  readonly fulfillment: OrderFulfillmentSnapshot;
  readonly items: readonly OrderItemSnapshot[];
  readonly orderNote: string | null;
  readonly itemsSubtotalMinor: MoneyMinor;
  readonly discountMinor: MoneyMinor;
  readonly deliveryFeeMinor: MoneyMinor;
  readonly totalMinor: MoneyMinor;
  readonly payments: readonly PaymentPart[];
}

export type ExpensePaidFrom = 'CASH' | 'OTHER';

export type Expense =
  | {
      readonly id: ExpenseId;
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly kind: 'MANUAL';
      readonly description: string;
      readonly amountMinor: MoneyMinor;
      readonly paidFrom: ExpensePaidFrom;
      readonly note: string | null;
      readonly orderId: null;
      readonly createdByWorkerId: WorkerId;
      readonly createdAt: Instant;
    }
  | {
      readonly id: ExpenseId;
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly kind: 'DELIVERY_FAILED';
      readonly description: string;
      readonly amountMinor: null;
      readonly paidFrom: null;
      readonly note: string | null;
      readonly orderId: OrderId;
      readonly createdByWorkerId: WorkerId;
      readonly createdAt: Instant;
    };

export type InventoryTrackingMode = 'RECIPE_TRACKED' | 'BULK_MANUAL';

export interface InventoryItem {
  readonly id: InventoryItemId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly unitLabel: string;
  readonly trackingMode: InventoryTrackingMode;
  readonly active: boolean;
}

export type InventoryMovementType =
  | 'ORDER_CONSUMPTION'
  | 'CANCEL_RESTOCK'
  | 'BULK_UNIT_FINISHED'
  | 'BULK_STOCK_RECEIVED'
  | 'UNDO_BULK_UNIT_FINISHED'
  | 'UNDO_BULK_STOCK_RECEIVED'
  | 'ADMIN_ADJUSTMENT';

export interface InventoryMovement {
  readonly id: InventoryMovementId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId | null;
  readonly itemId: InventoryItemId;
  readonly movementType: InventoryMovementType;
  readonly quantityDeltaMicros: StockQuantityMicros;
  readonly idempotencyKey: string;
  readonly workerId: WorkerId;
  readonly orderId: OrderId | null;
  readonly createdAt: Instant;
  readonly compensatesMovementId: InventoryMovementId | null;
}

export interface ReconciliationLine {
  readonly paymentMethod: PaymentMethodSnapshot;
  readonly expectedMinor: MoneyMinor;
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
  readonly varianceReason: string | null;
}

export interface Reconciliation {
  readonly id: ReconciliationId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly createdByWorkerId: WorkerId;
  readonly createdAt: Instant;
  readonly lines: readonly ReconciliationLine[];
}

export type AuditEventType =
  | 'BUSINESS_DAY_STARTED'
  | 'BUSINESS_DAY_CLOSED'
  | 'WORKER_SIGNED_IN'
  | 'WORKER_SWITCHED'
  | 'ORDER_PLACED'
  | 'ORDER_MARKED_DONE'
  | 'ORDER_DONE_UNDONE'
  | 'ORDER_CANCELLED'
  | 'DELIVERY_RETURNED'
  | 'EXPENSE_CREATED'
  | 'EXPENSE_EDITED'
  | 'EXPENSE_DELETED'
  | 'INVENTORY_MOVEMENT_RECORDED'
  | 'RECONCILIATION_RECORDED';

export interface AuditEvent {
  readonly id: AuditEventId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: AuditEventType;
  readonly workerId: WorkerId | null;
  readonly createdAt: Instant;
  readonly details: JsonValue;
}

export interface OutboxEvent {
  readonly id: OutboxEventId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly idempotencyKey: string;
  readonly payloadVersion: number;
  readonly payload: JsonValue;
  readonly createdAt: Instant;
  readonly attemptCount: number;
  readonly nextAttemptAt: Instant | null;
  readonly lastError: string | null;
  readonly deliveredAt: Instant | null;
}

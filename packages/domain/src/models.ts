export type OrderStatus = 'ACTIVE' | 'DONE' | 'CANCELLED' | 'RETURNED';
export type OrderSource = 'POS' | 'ONLINE';

export interface OrderReasonCodeSnapshot {
  readonly id: string;
  readonly key: string;
  readonly family: ConfiguredReasonFamily;
  readonly label: string;
  readonly version: number;
  readonly scope: 'BUSINESS' | 'SHOP';
}

export interface OrderCancellationSnapshot {
  readonly at: Instant;
  readonly workerId: WorkerId;
  readonly workerName: string;
  readonly foodPrepared: boolean;
  readonly stockRestored: boolean;
  readonly reason: string;
  /** Present for configured future mutations; absent on legacy cancellations. */
  readonly reasonCode?: OrderReasonCodeSnapshot;
  /** Optional operator context; never the reason authority. */
  readonly note?: string;
}

export interface OrderReturnSnapshot {
  readonly at: Instant;
  readonly workerId: WorkerId;
  readonly workerName: string;
  readonly reason: string;
}

export interface OrderLifecycleSnapshot {
  readonly revision: number;
  readonly doneAt: Instant | null;
  readonly cancellation: OrderCancellationSnapshot | null;
  readonly returned: OrderReturnSnapshot | null;
}

export interface OrderReceiptSnapshot {
  readonly configurationVersion: number;
  readonly shopDisplayName: string;
  readonly address: string | null;
  readonly contactPhone: string | null;
  readonly footer: string | null;
  readonly orderNumberPrefix: string;
}

export interface OrderCheckoutPaymentRuleSnapshot {
  readonly paymentMethodId: PaymentMethodId;
  readonly channel: PaymentMethodChannel;
  readonly deliveryZoneId: DeliveryZoneId | null;
  readonly zoneAllowed: boolean;
}

export interface OrderCheckoutSnapshot {
  readonly configurationVersion: number;
  readonly settingsVersion: number | null;
  readonly channel: OrderSource;
  readonly minimumOrderMinor: MoneyMinor;
  readonly minimumOrderSatisfied: boolean;
  readonly allowDiscountStacking: boolean;
  readonly serviceChargeBps: number;
  readonly serviceChargeMinor: MoneyMinor;
  readonly taxBps: number;
  readonly taxMinor: MoneyMinor;
  readonly deliveryFeeMinor: MoneyMinor;
  readonly discountMinor: MoneyMinor;
  readonly paymentRules: readonly OrderCheckoutPaymentRuleSnapshot[];
}

export interface OrderSnapshot {
  readonly id: OrderId;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly displayOrderNo: number;
  /** Immutable configured identity for orders created after receipt settings adoption. */
  readonly displayOrderLabel?: string;
  /** Optional for backwards compatibility with legacy persisted orders. */
  readonly receiptSnapshot?: OrderReceiptSnapshot;
  readonly idempotencyKey: string;
  readonly status: OrderStatus;
  readonly lifecycle?: OrderLifecycleSnapshot;
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
  /** Optional on legacy orders; all new checkout-policy-aware orders persist these values. */
  readonly serviceChargeMinor?: MoneyMinor;
  readonly taxMinor?: MoneyMinor;
  readonly checkoutSnapshot?: OrderCheckoutSnapshot;
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
      readonly businessDayId: BusinessDayId | null;
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

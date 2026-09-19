export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export type AdminSupplier = {
  readonly id: string;
  readonly businessId: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly active: boolean;
};

export type AdminSupplierInventoryItem = {
  readonly supplierId: string;
  readonly inventoryItemId: string;
  readonly supplierSku: string | null;
  readonly purchaseUnitLabel: string;
  readonly baseMicrosPerPurchaseUnit: number;
  readonly lastUnitCostMinor: number | null;
  readonly active: boolean;
};

export type AdminPurchaseOrderLine = {
  readonly id: string;
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly purchaseUnitLabel: string;
  readonly orderedBaseMicros: number;
  readonly receivedBaseMicros: number;
  readonly returnedBaseMicros: number;
  readonly remainingBaseMicros: number;
  readonly expectedUnitCostMinor: number;
};

export type AdminPurchaseOrder = {
  readonly id: string;
  readonly shopId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: PurchaseOrderStatus;
  readonly reference: string | null;
  readonly expectedDeliveryDate: string | null;
  readonly version: number;
  readonly orderedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly AdminPurchaseOrderLine[];
};

export type AdminPurchasingWorkspace = {
  readonly shopId: string;
  readonly suppliers: readonly AdminSupplier[];
  readonly purchaseOrders: readonly AdminPurchaseOrder[];
};

export type CreateSupplierInput = {
  readonly shopId: string;
  readonly name: string;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
};

export type CreatePurchaseOrderInput = {
  readonly shopId: string;
  readonly supplierId: string;
  readonly reference: string | null;
  readonly expectedDeliveryDate: string | null;
  readonly lines: readonly {
    readonly inventoryItemId: string;
    readonly purchaseUnitLabel: string;
    readonly orderedBaseMicros: number;
    readonly expectedUnitCostMinor: number;
  }[];
  readonly commandId: string;
};

export type UpdatePurchaseOrderInput = {
  readonly shopId: string;
  readonly purchaseOrderId: string;
  readonly expectedVersion: number;
  readonly reference: string | null;
  readonly expectedDeliveryDate: string | null;
};

export type ReceivePurchaseInput = {
  readonly shopId: string;
  readonly purchaseOrderId: string;
  readonly commandId: string;
  readonly supplierReference: string | null;
  readonly lines: readonly {
    readonly lineId: string;
    readonly receivedBaseMicros: number;
    readonly unitCostMinor: number;
  }[];
};

export type ReturnPurchaseInput = {
  readonly shopId: string;
  readonly purchaseOrderId: string;
  readonly commandId: string;
  readonly supplierReference: string | null;
  readonly lines: readonly {
    readonly lineId: string;
    readonly returnedBaseMicros: number;
    readonly unitCostMinor: number;
  }[];
};

export type PurchasingCommandResult =
  | {
      readonly ok: true;
      readonly supplierId?: string;
      readonly purchaseOrderId?: string;
      readonly receiptId?: string;
      readonly returnId?: string;
      readonly status?: PurchaseOrderStatus;
      readonly version?: number;
      readonly idempotentReplay?: boolean;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly currentVersion?: number;
      readonly lineId?: string;
      readonly remainingBaseMicros?: number;
      readonly returnableBaseMicros?: number;
    };

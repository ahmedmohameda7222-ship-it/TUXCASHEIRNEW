export interface InventoryBalance {
  readonly onHandMicros: number;
  readonly reservedMicros: number;
  readonly availableMicros: number;
}

export interface RecipeCostIngredient {
  readonly inventoryItemId: string;
  readonly quantityMicros: number;
  readonly unitCostMinor: number;
  readonly costMinor: number;
}

export interface RecipeCost {
  readonly totalMinor: number;
  readonly ingredients: readonly RecipeCostIngredient[];
}

export type AdminInventoryReasonFamily = 'WASTE' | 'STOCK_ADJUSTMENT';

export interface AdminInventoryReasonCode {
  readonly id: string;
  readonly key: string;
  readonly family: AdminInventoryReasonFamily;
  readonly label: string;
}

export interface AdminInventoryMovement {
  readonly id: string;
  readonly movementType: string;
  readonly quantityDeltaMicros: number;
  readonly reservedDeltaMicros: number;
  readonly reasonLabel: string | null;
  readonly createdAt: string;
}

export interface AdminInventoryItem extends InventoryBalance {
  readonly id: string;
  readonly name: string;
  readonly unitLabel: string;
  readonly trackingMode: string;
  readonly active: boolean;
  readonly weightedUnitCostMinor: number;
  readonly history: readonly AdminInventoryMovement[];
}

export interface AdminInventoryTransferLine {
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly quantityMicros: number;
}

export interface AdminInventoryTransfer {
  readonly id: string;
  readonly sourceShopId: string;
  readonly destinationShopId: string;
  readonly status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  readonly sentAt: string;
  readonly receivedAt: string | null;
  readonly lines: readonly AdminInventoryTransferLine[];
}

export interface AdminInventoryReorderSuggestion {
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly availableMicros: number;
  readonly incomingMicros: number;
  readonly parLevelMicros: number;
  readonly reorderPointMicros: number;
  readonly suggestedOrderMicros: number;
  readonly preferredSupplierId: string | null;
  readonly preferredPurchaseUnit: string | null;
  readonly leadTimeDays: number;
  readonly minimumOrderMicros: number | null;
  readonly orderMultipleMicros: number | null;
  readonly version: number;
}

export interface AdminInventoryVariance {
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly unitLabel: string;
  readonly actualUsageMicros: number;
  readonly theoreticalUsageMicros: number;
  readonly varianceMicros: number;
  readonly variancePercent: number | null;
}

export interface AdminInventoryMarginContributor {
  readonly inventoryItemId: string;
  readonly itemName: string;
  readonly costMinor: number;
}

export interface AdminInventoryMarginAlert {
  readonly productId: string;
  readonly productName: string;
  readonly productPriceMinor: number;
  readonly recipeCostMinor: number;
  readonly foodCostPercent: number;
  readonly targetFoodCostPercent: number;
  readonly alertThresholdPercent: number;
  readonly alert: boolean;
  readonly largestContributor: AdminInventoryMarginContributor | null;
}

export interface AdminInventoryIntelligence {
  readonly periodLabel: string;
  readonly reorderSuggestions: readonly AdminInventoryReorderSuggestion[];
  readonly variances: readonly AdminInventoryVariance[];
  readonly marginAlerts: readonly AdminInventoryMarginAlert[];
}

export interface AdminInventoryWorkspace {
  readonly shopId: string;
  readonly items: readonly AdminInventoryItem[];
  readonly reasonCodes: readonly AdminInventoryReasonCode[];
  readonly transfers: readonly AdminInventoryTransfer[];
  readonly intelligence: AdminInventoryIntelligence;
}

export interface AdminStocktakeSnapshotLine {
  readonly inventoryItemId: string;
  readonly snapshotOnHandMicros: number;
  readonly snapshotReservedMicros: number;
  readonly unitCostMinor: number;
}

export interface AdminStocktakeSnapshot {
  readonly stocktakeId: string;
  readonly lines: readonly AdminStocktakeSnapshotLine[];
}

export type AdminInventoryCommand =
  | {
      readonly type: 'adjust';
      readonly shopId: string;
      readonly inventoryItemId: string;
      readonly quantityDeltaMicros: number;
      readonly reasonCodeId: string;
      readonly note: string | null;
      readonly emergencyNegativeOverride: boolean;
      readonly commandId: string;
    }
  | {
      readonly type: 'waste';
      readonly shopId: string;
      readonly inventoryItemId: string;
      readonly quantityMicros: number;
      readonly reasonCodeId: string;
      readonly note: string | null;
      readonly emergencyNegativeOverride: boolean;
      readonly commandId: string;
    }
  | {
      readonly type: 'stocktake.begin';
      readonly shopId: string;
      readonly inventoryItemIds: readonly string[];
      readonly commandId: string;
    }
  | {
      readonly type: 'stocktake.post';
      readonly shopId: string;
      readonly stocktakeId: string;
      readonly lines: readonly {
        readonly inventoryItemId: string;
        readonly actualCountMicros: number;
      }[];
      readonly commandId: string;
    }
  | {
      readonly type: 'transfer.send';
      readonly shopId: string;
      readonly destinationShopId: string;
      readonly lines: readonly {
        readonly inventoryItemId: string;
        readonly quantityMicros: number;
      }[];
      readonly commandId: string;
    }
  | {
      readonly type: 'replenishment.update';
      readonly shopId: string;
      readonly inventoryItemId: string;
      readonly parLevelMicros: number;
      readonly reorderPointMicros: number;
      readonly preferredPurchaseUnit: string | null;
      readonly leadTimeDays: number;
      readonly minimumOrderMicros: number | null;
      readonly orderMultipleMicros: number | null;
    }
  | {
      readonly type: 'transfer.receive';
      readonly shopId: string;
      readonly transferId: string;
      readonly commandId: string;
    };

export type AdminInventoryCommandResult =
  | {
      readonly ok: true;
      readonly idempotentReplay?: boolean;
      readonly movementId?: string;
      readonly stocktakeId?: string;
      readonly lines?: readonly AdminStocktakeSnapshotLine[];
      readonly transferId?: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly inventoryItemId?: string;
      readonly availableMicros?: number;
    };

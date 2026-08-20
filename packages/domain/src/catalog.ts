import type {
  CustomerContactId,
  DeliveryZoneId,
  InventoryItemId,
  MenuCategoryId,
  ModifierId,
  OrderTypeId,
  PaymentMethodId,
  ProductId,
  ShopId,
} from './ids';
import type { MoneyMinor } from './money';
import type { OrderTypeBehavior, PaymentLogicType } from './models';
import type { StockQuantityMicros } from './quantity';
import type { Instant } from './time';

export interface MenuCategory {
  readonly id: MenuCategoryId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface Product {
  readonly id: ProductId;
  readonly shopId: ShopId;
  readonly categoryId: MenuCategoryId;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: MoneyMinor;
  readonly imageKey: string | null;
  /** Optional merchandising family inside a top-level category, e.g. TUX / TUXIFY. */
  readonly family?: string | null;
  readonly active: boolean;
  readonly soldOut: boolean;
  readonly isCombo: boolean;
  readonly sortOrder: number;
}

export interface Modifier {
  readonly id: ModifierId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly priceMinor: MoneyMinor;
  readonly standaloneProductId: ProductId | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface ProductModifierLink {
  readonly shopId: ShopId;
  readonly productId: ProductId;
  readonly modifierId: ModifierId;
  readonly maxQuantity: number | null;
  readonly sortOrder: number;
}

export interface ComboBeverageOption {
  readonly shopId: ShopId;
  readonly comboProductId: ProductId;
  readonly beverageProductId: ProductId;
  readonly sortOrder: number;
}

export interface RecipeLine {
  readonly shopId: ShopId;
  readonly productId: ProductId;
  readonly inventoryItemId: InventoryItemId;
  readonly quantityMicros: StockQuantityMicros;
}

export interface OrderType {
  readonly id: OrderTypeId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly behavior: OrderTypeBehavior;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface PaymentMethod {
  readonly id: PaymentMethodId;
  readonly shopId: ShopId;
  readonly displayName: string;
  readonly logicType: PaymentLogicType;
  readonly requiresReconciliation: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface DeliveryZone {
  readonly id: DeliveryZoneId;
  readonly shopId: ShopId;
  readonly name: string;
  readonly feeMinor: MoneyMinor;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface OperationsConfigurationSnapshot {
  readonly shopId: ShopId;
  readonly version: number;
  readonly updatedAt: Instant;
  readonly categories: readonly MenuCategory[];
  readonly products: readonly Product[];
  readonly modifiers: readonly Modifier[];
  readonly productModifierLinks: readonly ProductModifierLink[];
  readonly comboBeverageOptions: readonly ComboBeverageOption[];
  readonly recipeLines: readonly RecipeLine[];
  readonly orderTypes: readonly OrderType[];
  readonly paymentMethods: readonly PaymentMethod[];
  readonly deliveryZones: readonly DeliveryZone[];
}

export interface CustomerContact {
  readonly id: CustomerContactId;
  readonly shopId: ShopId;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly name: string;
  readonly latestAddress: string | null;
  readonly latestZoneId: DeliveryZoneId | null;
  readonly lastOrderAt: Instant | null;
}

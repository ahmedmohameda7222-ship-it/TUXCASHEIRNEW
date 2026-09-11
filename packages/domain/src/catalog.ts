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
} from './ids.ts';
import type { MoneyMinor } from './money.ts';
import type { OrderTypeBehavior, PaymentLogicType } from './models.ts';
import type { StockQuantityMicros } from './quantity.ts';
import type {
  ConfiguredReasonCode,
  OperationsPublishedSettings,
  PaymentMethodChannel,
} from './settings.ts';
import type { Instant } from './time.ts';

export interface MenuCategory {
  readonly id: MenuCategoryId;
  readonly shopId: ShopId;
  /** Stable customer route identity. Optional while legacy canonical rows await authorized migration. */
  readonly slug?: string | null;
  readonly name: string;
  /** Customer-facing category copy. Optional while legacy Operations snapshots coexist. */
  readonly description?: string | null;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface Product {
  readonly id: ProductId;
  readonly shopId: ShopId;
  readonly categoryId: MenuCategoryId;
  /** Stable customer/deep-link identity. Optional while legacy canonical rows await authorized migration. */
  readonly slug?: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: MoneyMinor;
  readonly imageKey: string | null;
  /** Optional merchandising family inside a top-level category, e.g. TUX / TUXIFY. */
  readonly family?: string | null;
  /** Canonical merchandising state; optional for compatibility with existing Operations snapshots. */
  readonly bestSeller?: boolean;
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
  /** Additive Admin settings fields. Legacy constructors may omit them; parser output always fills defaults. */
  readonly channel?: PaymentMethodChannel;
  readonly requiresReference?: boolean;
  readonly manualConfirmationRequired?: boolean;
  readonly refundAllowed?: boolean;
  readonly integrationReference?: string | null;
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
  /** Optional at the type boundary for legacy source compatibility; parser output normalizes absence to null. */
  readonly settings?: OperationsPublishedSettings | null;
  /** Optional at the type boundary for legacy source compatibility; parser output normalizes absence to []. */
  readonly reasonCodes?: readonly ConfiguredReasonCode[];
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

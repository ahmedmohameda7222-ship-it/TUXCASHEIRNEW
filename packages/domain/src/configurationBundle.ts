import type {
  ComboBeverageOption,
  DeliveryZone,
  MenuCategory,
  Modifier,
  OperationsConfigurationSnapshot,
  OrderType,
  PaymentMethod,
  Product,
  ProductModifierLink,
  RecipeLine,
} from './catalog';
import {
  parseEntityId,
  type DeliveryZoneId,
  type EntityId,
  type InventoryItemId,
  type MenuCategoryId,
  type ModifierId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
} from './ids';
import { assertNonNegativeMoney, moneyMinor } from './money';
import type {
  InventoryItem,
  InventoryTrackingMode,
  OrderTypeBehavior,
  PaymentLogicType,
} from './models';
import { stockQuantityMicros } from './quantity';
import { instant } from './time';

export interface OperationsConfigurationBundle {
  readonly snapshot: OperationsConfigurationSnapshot;
  readonly inventoryItems: readonly InventoryItem[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label, true);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function safeInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      `${label} must be a safe integer${minimum > Number.MIN_SAFE_INTEGER ? ` >= ${minimum}` : ''}.`,
    );
  }
  return value;
}

function id<Id extends EntityId>(value: unknown, label: string): Id {
  return parseEntityId<Id>(string(value, label));
}

function sameShop(value: unknown, shopId: ShopId, label: string): ShopId {
  const parsed = id<ShopId>(value, `${label} shopId`);
  if (parsed !== shopId) throw new TypeError(`${label} belongs to a different shop.`);
  return parsed;
}

function nonNegativeMoney(value: unknown, label: string) {
  const parsed = moneyMinor(safeInteger(value, label));
  assertNonNegativeMoney(parsed, label);
  return parsed;
}

function sortOrder(value: unknown, label: string): number {
  return safeInteger(value, `${label} sortOrder`, 0);
}

function uniqueId<Id extends EntityId>(seen: Set<string>, value: Id, label: string): Id {
  if (seen.has(value)) throw new TypeError(`Duplicate ${label} id ${value}.`);
  seen.add(value);
  return value;
}

function parseCategory(value: unknown, shopId: ShopId, seen: Set<string>): MenuCategory {
  const source = record(value, 'configuration category');
  return {
    id: uniqueId(seen, id<MenuCategoryId>(source['id'], 'category id'), 'category'),
    shopId: sameShop(source['shopId'], shopId, 'category'),
    name: string(source['name'], 'category name'),
    sortOrder: sortOrder(source['sortOrder'], 'category'),
    active: boolean(source['active'], 'category active'),
  };
}

function parseProduct(value: unknown, shopId: ShopId, seen: Set<string>): Product {
  const source = record(value, 'configuration product');
  return {
    id: uniqueId(seen, id<ProductId>(source['id'], 'product id'), 'product'),
    shopId: sameShop(source['shopId'], shopId, 'product'),
    categoryId: id<MenuCategoryId>(source['categoryId'], 'product categoryId'),
    name: string(source['name'], 'product name'),
    description: nullableString(source['description'], 'product description'),
    priceMinor: nonNegativeMoney(source['priceMinor'], 'product priceMinor'),
    imageKey: nullableString(source['imageKey'], 'product imageKey'),
    active: boolean(source['active'], 'product active'),
    soldOut: boolean(source['soldOut'], 'product soldOut'),
    isCombo: boolean(source['isCombo'], 'product isCombo'),
    sortOrder: sortOrder(source['sortOrder'], 'product'),
  };
}

function parseModifier(value: unknown, shopId: ShopId, seen: Set<string>): Modifier {
  const source = record(value, 'configuration modifier');
  return {
    id: uniqueId(seen, id<ModifierId>(source['id'], 'modifier id'), 'modifier'),
    shopId: sameShop(source['shopId'], shopId, 'modifier'),
    name: string(source['name'], 'modifier name'),
    priceMinor: moneyMinor(safeInteger(source['priceMinor'], 'modifier priceMinor')),
    standaloneProductId:
      source['standaloneProductId'] === null
        ? null
        : id<ProductId>(source['standaloneProductId'], 'modifier standaloneProductId'),
    active: boolean(source['active'], 'modifier active'),
    sortOrder: sortOrder(source['sortOrder'], 'modifier'),
  };
}

function parseProductModifierLink(value: unknown, shopId: ShopId): ProductModifierLink {
  const source = record(value, 'configuration product modifier link');
  return {
    shopId: sameShop(source['shopId'], shopId, 'product modifier link'),
    productId: id<ProductId>(source['productId'], 'product modifier link productId'),
    modifierId: id<ModifierId>(source['modifierId'], 'product modifier link modifierId'),
    maxQuantity:
      source['maxQuantity'] === null
        ? null
        : safeInteger(source['maxQuantity'], 'product modifier link maxQuantity', 1),
    sortOrder: sortOrder(source['sortOrder'], 'product modifier link'),
  };
}

function parseComboBeverageOption(value: unknown, shopId: ShopId): ComboBeverageOption {
  const source = record(value, 'configuration combo beverage option');
  return {
    shopId: sameShop(source['shopId'], shopId, 'combo beverage option'),
    comboProductId: id<ProductId>(source['comboProductId'], 'combo product id'),
    beverageProductId: id<ProductId>(source['beverageProductId'], 'beverage product id'),
    sortOrder: sortOrder(source['sortOrder'], 'combo beverage option'),
  };
}

function parseRecipeLine(value: unknown, shopId: ShopId): RecipeLine {
  const source = record(value, 'configuration recipe line');
  const quantityMicros = stockQuantityMicros(
    safeInteger(source['quantityMicros'], 'recipe quantityMicros', 1),
  );
  return {
    shopId: sameShop(source['shopId'], shopId, 'recipe line'),
    productId: id<ProductId>(source['productId'], 'recipe productId'),
    inventoryItemId: id<InventoryItemId>(source['inventoryItemId'], 'recipe inventoryItemId'),
    quantityMicros,
  };
}

function orderTypeBehavior(value: unknown): OrderTypeBehavior {
  if (value === 'TAKE_AWAY' || value === 'DINE_IN' || value === 'DELIVERY' || value === 'OTHER') {
    return value;
  }
  throw new TypeError('order type behavior is invalid.');
}

function parseOrderType(value: unknown, shopId: ShopId, seen: Set<string>): OrderType {
  const source = record(value, 'configuration order type');
  return {
    id: uniqueId(seen, id<OrderTypeId>(source['id'], 'order type id'), 'order type'),
    shopId: sameShop(source['shopId'], shopId, 'order type'),
    name: string(source['name'], 'order type name'),
    behavior: orderTypeBehavior(source['behavior']),
    active: boolean(source['active'], 'order type active'),
    sortOrder: sortOrder(source['sortOrder'], 'order type'),
  };
}

function paymentLogicType(value: unknown): PaymentLogicType {
  if (value === 'CASH' || value === 'CARD' || value === 'DIGITAL' || value === 'OTHER')
    return value;
  throw new TypeError('payment method logicType is invalid.');
}

function parsePaymentMethod(value: unknown, shopId: ShopId, seen: Set<string>): PaymentMethod {
  const source = record(value, 'configuration payment method');
  return {
    id: uniqueId(seen, id<PaymentMethodId>(source['id'], 'payment method id'), 'payment method'),
    shopId: sameShop(source['shopId'], shopId, 'payment method'),
    displayName: string(source['displayName'], 'payment method displayName'),
    logicType: paymentLogicType(source['logicType']),
    requiresReconciliation: boolean(
      source['requiresReconciliation'],
      'payment method requiresReconciliation',
    ),
    active: boolean(source['active'], 'payment method active'),
    sortOrder: sortOrder(source['sortOrder'], 'payment method'),
  };
}

function parseDeliveryZone(value: unknown, shopId: ShopId, seen: Set<string>): DeliveryZone {
  const source = record(value, 'configuration delivery zone');
  return {
    id: uniqueId(seen, id<DeliveryZoneId>(source['id'], 'delivery zone id'), 'delivery zone'),
    shopId: sameShop(source['shopId'], shopId, 'delivery zone'),
    name: string(source['name'], 'delivery zone name'),
    feeMinor: nonNegativeMoney(source['feeMinor'], 'delivery zone feeMinor'),
    active: boolean(source['active'], 'delivery zone active'),
    sortOrder: sortOrder(source['sortOrder'], 'delivery zone'),
  };
}

function inventoryTrackingMode(value: unknown): InventoryTrackingMode {
  if (value === 'RECIPE_TRACKED' || value === 'BULK_MANUAL') return value;
  throw new TypeError('inventory item trackingMode is invalid.');
}

function parseInventoryItem(value: unknown, shopId: ShopId, seen: Set<string>): InventoryItem {
  const source = record(value, 'configuration inventory item');
  return {
    id: uniqueId(seen, id<InventoryItemId>(source['id'], 'inventory item id'), 'inventory item'),
    shopId: sameShop(source['shopId'], shopId, 'inventory item'),
    name: string(source['name'], 'inventory item name'),
    unitLabel: string(source['unitLabel'], 'inventory item unitLabel'),
    trackingMode: inventoryTrackingMode(source['trackingMode']),
    active: boolean(source['active'], 'inventory item active'),
  };
}

function assertReference(set: ReadonlySet<string>, value: string, label: string): void {
  if (!set.has(value)) throw new TypeError(`${label} references missing id ${value}.`);
}

function assertUniquePair(seen: Set<string>, left: string, right: string, label: string): void {
  const key = `${left}:${right}`;
  if (seen.has(key)) throw new TypeError(`Duplicate ${label} ${key}.`);
  seen.add(key);
}

/**
 * Deeply validates a complete, versioned Operations configuration before it can replace local state.
 * The returned bundle contains only reconstructed domain values; arbitrary network JSON is never cast.
 */
export function parseOperationsConfigurationBundle(
  value: unknown,
  expectedShopId?: ShopId,
): OperationsConfigurationBundle {
  const root = record(value, 'configuration bundle');
  const snapshotSource = record(root['snapshot'], 'configuration snapshot');
  const shopId = id<ShopId>(snapshotSource['shopId'], 'configuration shopId');
  if (expectedShopId !== undefined && shopId !== expectedShopId) {
    throw new TypeError('Remote configuration shop identity does not match the assigned shop.');
  }

  const categoryIds = new Set<string>();
  const productIds = new Set<string>();
  const modifierIds = new Set<string>();
  const orderTypeIds = new Set<string>();
  const paymentMethodIds = new Set<string>();
  const deliveryZoneIds = new Set<string>();
  const inventoryItemIds = new Set<string>();

  const categories = array(snapshotSource['categories'], 'configuration categories').map((entry) =>
    parseCategory(entry, shopId, categoryIds),
  );
  const products = array(snapshotSource['products'], 'configuration products').map((entry) =>
    parseProduct(entry, shopId, productIds),
  );
  const modifiers = array(snapshotSource['modifiers'], 'configuration modifiers').map((entry) =>
    parseModifier(entry, shopId, modifierIds),
  );
  const productModifierLinks = array(
    snapshotSource['productModifierLinks'],
    'configuration productModifierLinks',
  ).map((entry) => parseProductModifierLink(entry, shopId));
  const comboBeverageOptions = array(
    snapshotSource['comboBeverageOptions'],
    'configuration comboBeverageOptions',
  ).map((entry) => parseComboBeverageOption(entry, shopId));
  const recipeLines = array(snapshotSource['recipeLines'], 'configuration recipeLines').map(
    (entry) => parseRecipeLine(entry, shopId),
  );
  const orderTypes = array(snapshotSource['orderTypes'], 'configuration orderTypes').map((entry) =>
    parseOrderType(entry, shopId, orderTypeIds),
  );
  const paymentMethods = array(
    snapshotSource['paymentMethods'],
    'configuration paymentMethods',
  ).map((entry) => parsePaymentMethod(entry, shopId, paymentMethodIds));
  const deliveryZones = array(snapshotSource['deliveryZones'], 'configuration deliveryZones').map(
    (entry) => parseDeliveryZone(entry, shopId, deliveryZoneIds),
  );
  const inventoryItems = array(root['inventoryItems'], 'configuration inventoryItems').map(
    (entry) => parseInventoryItem(entry, shopId, inventoryItemIds),
  );

  for (const product of products)
    assertReference(categoryIds, product.categoryId, 'product category');
  for (const modifier of modifiers) {
    if (modifier.standaloneProductId !== null) {
      assertReference(productIds, modifier.standaloneProductId, 'modifier standalone product');
    }
  }

  const productModifierPairs = new Set<string>();
  for (const link of productModifierLinks) {
    assertReference(productIds, link.productId, 'product modifier link product');
    assertReference(modifierIds, link.modifierId, 'product modifier link modifier');
    assertUniquePair(
      productModifierPairs,
      link.productId,
      link.modifierId,
      'product modifier link',
    );
  }

  const comboPairs = new Set<string>();
  for (const option of comboBeverageOptions) {
    assertReference(productIds, option.comboProductId, 'combo option combo product');
    assertReference(productIds, option.beverageProductId, 'combo option beverage product');
    const comboProduct = products.find((product) => product.id === option.comboProductId);
    if (comboProduct?.isCombo !== true) {
      throw new TypeError(
        `Combo beverage option references non-combo product ${option.comboProductId}.`,
      );
    }
    assertUniquePair(
      comboPairs,
      option.comboProductId,
      option.beverageProductId,
      'combo beverage option',
    );
  }

  const recipePairs = new Set<string>();
  for (const line of recipeLines) {
    assertReference(productIds, line.productId, 'recipe product');
    assertReference(inventoryItemIds, line.inventoryItemId, 'recipe inventory item');
    assertUniquePair(recipePairs, line.productId, line.inventoryItemId, 'recipe line');
  }

  const snapshot: OperationsConfigurationSnapshot = {
    shopId,
    version: safeInteger(snapshotSource['version'], 'configuration version', 1),
    updatedAt: instant(string(snapshotSource['updatedAt'], 'configuration updatedAt')),
    categories,
    products,
    modifiers,
    productModifierLinks,
    comboBeverageOptions,
    recipeLines,
    orderTypes,
    paymentMethods,
    deliveryZones,
  };

  return { snapshot, inventoryItems };
}

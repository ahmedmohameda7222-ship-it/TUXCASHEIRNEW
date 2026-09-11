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
import type { JsonValue } from './json';
import { assertNonNegativeMoney, moneyMinor } from './money';
import type {
  InventoryItem,
  InventoryTrackingMode,
  OrderTypeBehavior,
  PaymentLogicType,
} from './models';
import { stockQuantityMicros } from './quantity';
import type {
  ConfiguredReasonCode,
  ConfiguredReasonFamily,
  OperationsPublishedSettings,
  OperationsShopIdentitySettings,
  OperationsSpecialHoursSetting,
  OperationsWeeklyHoursSetting,
  PaymentMethodChannel,
  PaymentMethodZoneRuleSetting,
  SettingsHoursServiceKind,
  ShopLifecycleState,
} from './settings';
import { instant } from './time';

export interface OperationsConfigurationBundle {
  readonly snapshot: OperationsConfigurationSnapshot;
  readonly inventoryItems: readonly InventoryItem[];
}

type UnknownRecord = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

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

function optionalBoolean(value: unknown, defaultValue: boolean, label: string): boolean {
  return value === undefined ? defaultValue : boolean(value, label);
}

function safeInteger(value: unknown, label: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      `${label} must be a safe integer${minimum > Number.MIN_SAFE_INTEGER ? ` >= ${minimum}` : ''}.`,
    );
  }
  return value;
}

function nullableFiniteNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be null or a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function id<Id extends EntityId>(value: unknown, label: string): Id {
  return parseEntityId<Id>(string(value, label));
}

function uuidString(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!UUID_PATTERN.test(parsed)) throw new TypeError(`${label} must be a UUID.`);
  return parsed;
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

function jsonValue(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`));
  const source = record(value, label);
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(source)) {
    result[key] = jsonValue(child, `${label}.${key}`);
  }
  return result;
}

function settingsValues(value: unknown): Readonly<Record<string, JsonValue>> {
  const source = record(value, 'configuration settings values');
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(source)) {
    if (!SETTING_KEY_PATTERN.test(key)) throw new TypeError(`configuration setting key ${key} is invalid.`);
    result[key] = jsonValue(child, `configuration setting ${key}`);
  }
  return result;
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
    family:
      source['family'] === undefined || source['family'] === null
        ? null
        : string(source['family'], 'product family'),
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
  if (value === 'CASH' || value === 'CARD' || value === 'DIGITAL' || value === 'OTHER') return value;
  throw new TypeError('payment method logicType is invalid.');
}

function paymentMethodChannel(value: unknown): PaymentMethodChannel {
  if (value === 'POS' || value === 'ONLINE' || value === 'BOTH') return value;
  throw new TypeError('payment method channel is invalid.');
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
    channel: source['channel'] === undefined ? 'BOTH' : paymentMethodChannel(source['channel']),
    requiresReference: optionalBoolean(
      source['requiresReference'],
      false,
      'payment method requiresReference',
    ),
    manualConfirmationRequired: optionalBoolean(
      source['manualConfirmationRequired'],
      false,
      'payment method manualConfirmationRequired',
    ),
    refundAllowed: optionalBoolean(source['refundAllowed'], true, 'payment method refundAllowed'),
    integrationReference:
      source['integrationReference'] === undefined || source['integrationReference'] === null
        ? null
        : string(source['integrationReference'], 'payment method integrationReference'),
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

function shopLifecycleState(value: unknown): ShopLifecycleState {
  if (value === 'ACTIVE' || value === 'SUSPENDED' || value === 'ARCHIVED') return value;
  throw new TypeError('configuration shop lifecycleState is invalid.');
}

function cairoTimezone(value: unknown, label: string): 'Africa/Cairo' {
  if (value !== 'Africa/Cairo') throw new TypeError(`${label} must be Africa/Cairo.`);
  return value;
}

function settingsServiceKind(value: unknown): SettingsHoursServiceKind {
  if (value === 'OPEN' || value === 'DELIVERY' || value === 'ONLINE') return value;
  throw new TypeError('configuration settings serviceKind is invalid.');
}

function localTime(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!LOCAL_TIME_PATTERN.test(parsed)) throw new TypeError(`${label} is invalid.`);
  return parsed;
}

function isoDate(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!ISO_DATE_PATTERN.test(parsed)) throw new TypeError(`${label} is invalid.`);
  return parsed;
}

function configuredReasonFamily(value: unknown): ConfiguredReasonFamily {
  if (
    value === 'CANCELLATION' ||
    value === 'REFUND_RETURN' ||
    value === 'DISCOUNT_COMP' ||
    value === 'WASTE' ||
    value === 'STOCK_ADJUSTMENT' ||
    value === 'CASH_VARIANCE' ||
    value === 'PAY_IN' ||
    value === 'PAY_OUT'
  ) {
    return value;
  }
  throw new TypeError('configuration reason code family is invalid.');
}

function parseShopIdentity(value: unknown, shopId: ShopId): OperationsShopIdentitySettings {
  const source = record(value, 'configuration settings shopIdentity');
  return {
    shopId: sameShop(source['shopId'], shopId, 'configuration settings shopIdentity'),
    displayName: string(source['displayName'], 'configuration settings shopIdentity displayName'),
    address: nullableString(source['address'], 'configuration settings shopIdentity address'),
    phone: nullableString(source['phone'], 'configuration settings shopIdentity phone'),
    latitude: nullableFiniteNumber(
      source['latitude'],
      'configuration settings shopIdentity latitude',
      -90,
      90,
    ),
    longitude: nullableFiniteNumber(
      source['longitude'],
      'configuration settings shopIdentity longitude',
      -180,
      180,
    ),
    timezone: cairoTimezone(source['timezone'], 'configuration settings shopIdentity timezone'),
    lifecycleState: shopLifecycleState(source['lifecycleState']),
    temporaryClosed: boolean(
      source['temporaryClosed'],
      'configuration settings shopIdentity temporaryClosed',
    ),
    onlineOrdersPaused: boolean(
      source['onlineOrdersPaused'],
      'configuration settings shopIdentity onlineOrdersPaused',
    ),
  };
}

function parseWeeklyHours(value: unknown): OperationsWeeklyHoursSetting {
  const source = record(value, 'configuration weekly hours');
  return {
    id: uuidString(source['id'], 'configuration weekly hours id'),
    serviceKind: settingsServiceKind(source['serviceKind']),
    dayOfWeek: safeInteger(source['dayOfWeek'], 'configuration weekly hours dayOfWeek', 0),
    timezone: cairoTimezone(source['timezone'], 'configuration weekly hours timezone'),
    opensLocal: localTime(source['opensLocal'], 'configuration weekly hours opensLocal'),
    closesLocal: localTime(source['closesLocal'], 'configuration weekly hours closesLocal'),
    active: boolean(source['active'], 'configuration weekly hours active'),
  };
}

function parseSpecialHours(value: unknown): OperationsSpecialHoursSetting {
  const source = record(value, 'configuration special hours');
  const closed = boolean(source['closed'], 'configuration special hours closed');
  const opensLocal =
    source['opensLocal'] === null
      ? null
      : localTime(source['opensLocal'], 'configuration special hours opensLocal');
  const closesLocal =
    source['closesLocal'] === null
      ? null
      : localTime(source['closesLocal'], 'configuration special hours closesLocal');
  if ((closed && (opensLocal !== null || closesLocal !== null)) || (!closed && (!opensLocal || !closesLocal))) {
    throw new TypeError('configuration special hours open/closed shape is invalid.');
  }
  return {
    id: uuidString(source['id'], 'configuration special hours id'),
    serviceDate: isoDate(source['serviceDate'], 'configuration special hours serviceDate'),
    serviceKind: settingsServiceKind(source['serviceKind']),
    timezone: cairoTimezone(source['timezone'], 'configuration special hours timezone'),
    closed,
    opensLocal,
    closesLocal,
    note: nullableString(source['note'], 'configuration special hours note'),
  };
}

function parsePaymentMethodZoneRule(value: unknown): PaymentMethodZoneRuleSetting {
  const source = record(value, 'configuration payment method zone rule');
  return {
    paymentMethodId: id<PaymentMethodId>(
      source['paymentMethodId'],
      'payment method zone rule paymentMethodId',
    ),
    deliveryZoneId: id<DeliveryZoneId>(
      source['deliveryZoneId'],
      'payment method zone rule deliveryZoneId',
    ),
    allowed: boolean(source['allowed'], 'payment method zone rule allowed'),
  };
}

function parsePublishedSettings(value: unknown, shopId: ShopId): OperationsPublishedSettings | null {
  if (value === undefined || value === null) return null;
  const source = record(value, 'configuration settings');
  const weeklyHours = array(source['weeklyHours'], 'configuration weeklyHours').map(parseWeeklyHours);
  for (const hours of weeklyHours) {
    if (hours.dayOfWeek > 6) throw new TypeError('configuration weekly hours dayOfWeek must be <= 6.');
  }
  return {
    version: safeInteger(source['version'], 'configuration settings version', 1),
    values: settingsValues(source['values']),
    shopIdentity: parseShopIdentity(source['shopIdentity'], shopId),
    weeklyHours,
    specialHours: array(source['specialHours'], 'configuration specialHours').map(parseSpecialHours),
    paymentMethodZoneRules: array(
      source['paymentMethodZoneRules'],
      'configuration paymentMethodZoneRules',
    ).map(parsePaymentMethodZoneRule),
  };
}

function parseConfiguredReasonCode(value: unknown): ConfiguredReasonCode {
  const source = record(value, 'configuration reason code');
  const scope = source['scope'];
  if (scope !== 'BUSINESS' && scope !== 'SHOP') {
    throw new TypeError('configuration reason code scope is invalid.');
  }
  return {
    id: uuidString(source['id'], 'configuration reason code id'),
    key: string(source['key'], 'configuration reason code key'),
    family: configuredReasonFamily(source['family']),
    label: string(source['label'], 'configuration reason code label'),
    active: boolean(source['active'], 'configuration reason code active'),
    version: safeInteger(source['version'], 'configuration reason code version', 1),
    scope,
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
  const settings = parsePublishedSettings(snapshotSource['settings'], shopId);
  const reasonCodes =
    snapshotSource['reasonCodes'] === undefined
      ? []
      : array(snapshotSource['reasonCodes'], 'configuration reasonCodes').map(parseConfiguredReasonCode);

  for (const product of products) assertReference(categoryIds, product.categoryId, 'product category');
  for (const modifier of modifiers) {
    if (modifier.standaloneProductId !== null) {
      assertReference(productIds, modifier.standaloneProductId, 'modifier standalone product');
    }
  }

  const productModifierPairs = new Set<string>();
  for (const link of productModifierLinks) {
    assertReference(productIds, link.productId, 'product modifier link product');
    assertReference(modifierIds, link.modifierId, 'product modifier link modifier');
    assertUniquePair(productModifierPairs, link.productId, link.modifierId, 'product modifier link');
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
    assertUniquePair(comboPairs, option.comboProductId, option.beverageProductId, 'combo beverage option');
  }

  const recipePairs = new Set<string>();
  for (const line of recipeLines) {
    assertReference(productIds, line.productId, 'recipe product');
    assertReference(inventoryItemIds, line.inventoryItemId, 'recipe inventory item');
    assertUniquePair(recipePairs, line.productId, line.inventoryItemId, 'recipe line');
  }

  if (settings !== null) {
    const zoneRulePairs = new Set<string>();
    for (const rule of settings.paymentMethodZoneRules) {
      assertReference(paymentMethodIds, rule.paymentMethodId, 'payment method zone rule payment method');
      assertReference(deliveryZoneIds, rule.deliveryZoneId, 'payment method zone rule delivery zone');
      assertUniquePair(
        zoneRulePairs,
        rule.paymentMethodId,
        rule.deliveryZoneId,
        'payment method zone rule',
      );
    }
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
    settings,
    reasonCodes,
  };

  return { snapshot, inventoryItems };
}

export class OnlineOrderIntakeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnlineOrderIntakeContractError';
  }
}

export type OnlineOrderFulfillmentPreferenceV1 = 'DELIVERY' | 'PICKUP';
export type OnlineOrderPaymentPreferenceV1 = 'CASH';

export interface OnlineOrderModifierSelectionV1 {
  modifierId: string;
  quantity: number;
}

export interface OnlineOrderItemV1 {
  productId: string;
  quantity: number;
  addonProductIds: string[];
  modifierSelections: OnlineOrderModifierSelectionV1[];
  comboBeverageProductId: string | null;
  note: string | null;
}

export interface OnlineOrderCustomerV1 {
  name: string;
  phone: string;
  address: string | null;
}

export interface OnlineOrderRequestV1 {
  schemaVersion: 1;
  shopId: string;
  idempotencyKey: string;
  customer: OnlineOrderCustomerV1;
  fulfillmentPreference: OnlineOrderFulfillmentPreferenceV1;
  paymentPreference: OnlineOrderPaymentPreferenceV1;
  items: OnlineOrderItemV1[];
  orderNote: string | null;
}

export interface OnlineOrderIntakeSuccessV1 {
  schemaVersion: 1;
  requestId: string;
  status: 'PENDING';
}

const ROOT_KEYS = [
  'schemaVersion',
  'shopId',
  'idempotencyKey',
  'customer',
  'fulfillmentPreference',
  'paymentPreference',
  'items',
  'orderNote',
] as const;
const CUSTOMER_KEYS = ['name', 'phone', 'address'] as const;
const ITEM_KEYS = [
  'productId',
  'quantity',
  'addonProductIds',
  'modifierSelections',
  'comboBeverageProductId',
  'note',
] as const;
const MODIFIER_KEYS = ['modifierId', 'quantity'] as const;
const SUCCESS_KEYS = ['schemaVersion', 'requestId', 'status'] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new OnlineOrderIntakeContractError(message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    fail(`${path} contains unexpected field ${unexpected[0]}`);
  }

  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${path}.${key} is required`);
    }
  }
}

function asUuid(value: unknown, path: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail(`${path} must be a UUID`);
  }
  return value;
}

function asBoundedString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') {
    fail(`${path} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || value.length > maxLength) {
    fail(`${path} must contain 1-${maxLength} characters`);
  }
  return value;
}

function asNullableBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  if (value === null) return null;
  return asBoundedString(value, path, maxLength);
}

function asPositiveInteger(value: unknown, path: string, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1 || value > max) {
    fail(`${path} must be an integer between 1 and ${max}`);
  }
  return value;
}

function parseModifierSelection(value: unknown, path: string): OnlineOrderModifierSelectionV1 {
  const record = asRecord(value, path);
  assertExactKeys(record, MODIFIER_KEYS, path);
  return {
    modifierId: asUuid(record.modifierId, `${path}.modifierId`),
    quantity: asPositiveInteger(record.quantity, `${path}.quantity`, 100),
  };
}

function parseItem(value: unknown, path: string): OnlineOrderItemV1 {
  const record = asRecord(value, path);
  assertExactKeys(record, ITEM_KEYS, path);

  if (!Array.isArray(record.addonProductIds) || record.addonProductIds.length > 20) {
    fail(`${path}.addonProductIds must contain at most 20 entries`);
  }
  const addonProductIds = record.addonProductIds.map((entry, index) =>
    asUuid(entry, `${path}.addonProductIds[${index}]`),
  );
  if (new Set(addonProductIds).size !== addonProductIds.length) {
    fail(`${path}.addonProductIds must not contain duplicates`);
  }

  if (!Array.isArray(record.modifierSelections) || record.modifierSelections.length > 20) {
    fail(`${path}.modifierSelections must contain at most 20 entries`);
  }
  const modifierSelections = record.modifierSelections.map((entry, index) =>
    parseModifierSelection(entry, `${path}.modifierSelections[${index}]`),
  );
  const modifierIds = modifierSelections.map((selection) => selection.modifierId);
  if (new Set(modifierIds).size !== modifierIds.length) {
    fail(`${path}.modifierSelections must not contain duplicate modifier IDs`);
  }

  return {
    productId: asUuid(record.productId, `${path}.productId`),
    quantity: asPositiveInteger(record.quantity, `${path}.quantity`, 100),
    addonProductIds,
    modifierSelections,
    comboBeverageProductId:
      record.comboBeverageProductId === null
        ? null
        : asUuid(record.comboBeverageProductId, `${path}.comboBeverageProductId`),
    note: asNullableBoundedString(record.note, `${path}.note`, 500),
  };
}

export function parseOnlineOrderRequestV1(value: unknown): OnlineOrderRequestV1 {
  const record = asRecord(value, 'request');
  assertExactKeys(record, ROOT_KEYS, 'request');

  if (record.schemaVersion !== 1) {
    fail('request.schemaVersion must equal 1');
  }

  const customerRecord = asRecord(record.customer, 'request.customer');
  assertExactKeys(customerRecord, CUSTOMER_KEYS, 'request.customer');

  if (record.fulfillmentPreference !== 'DELIVERY' && record.fulfillmentPreference !== 'PICKUP') {
    fail('request.fulfillmentPreference is unsupported');
  }
  const fulfillmentPreference = record.fulfillmentPreference;

  if (record.paymentPreference !== 'CASH') {
    fail('request.paymentPreference is unsupported');
  }

  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 50) {
    fail('request.items must contain 1-50 entries');
  }

  const address = asNullableBoundedString(customerRecord.address, 'request.customer.address', 500);
  if (fulfillmentPreference === 'DELIVERY' && address === null) {
    fail('request.customer.address is required for delivery');
  }

  return {
    schemaVersion: 1,
    shopId: asUuid(record.shopId, 'request.shopId'),
    idempotencyKey: asUuid(record.idempotencyKey, 'request.idempotencyKey'),
    customer: {
      name: asBoundedString(customerRecord.name, 'request.customer.name', 200),
      phone: asBoundedString(customerRecord.phone, 'request.customer.phone', 50),
      address,
    },
    fulfillmentPreference,
    paymentPreference: 'CASH',
    items: record.items.map((entry, index) => parseItem(entry, `request.items[${index}]`)),
    orderNote: asNullableBoundedString(record.orderNote, 'request.orderNote', 1000),
  };
}

export function parseOnlineOrderIntakeSuccessV1(value: unknown): OnlineOrderIntakeSuccessV1 {
  const record = asRecord(value, 'response');
  assertExactKeys(record, SUCCESS_KEYS, 'response');

  if (record.schemaVersion !== 1) {
    fail('response.schemaVersion must equal 1');
  }
  if (record.status !== 'PENDING') {
    fail('response.status must equal PENDING');
  }

  return {
    schemaVersion: 1,
    requestId: asUuid(record.requestId, 'response.requestId'),
    status: 'PENDING',
  };
}

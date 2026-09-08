import { instant, parseEntityId, type Instant, type ShopId } from '@tux/domain';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^[0-9a-f]{64}$/i;
const NORMALIZED_PHONE_PATTERN = /^01[0-9]{9}$/;

export type CachedOnlineOrderStatus = 'PENDING' | 'PROCESSING';
export type CachedOnlineOrderFulfillmentPreference = 'PICKUP' | 'DELIVERY';
export type CachedOnlineOrderPaymentPreference = 'CASH' | 'INSTAPAY' | 'MIXED';

export interface CachedOnlineOrderRequest {
  readonly requestId: string;
  readonly shopId: ShopId;
  readonly status: CachedOnlineOrderStatus;
  readonly catalogRevision: string;
  readonly fulfillmentPreference: CachedOnlineOrderFulfillmentPreference;
  readonly paymentPreference: CachedOnlineOrderPaymentPreference;
  readonly customerName: string;
  readonly normalizedPhone: string | null;
  readonly deliveryAddress: string | null;
  readonly trustedItems: readonly unknown[];
  readonly itemsSubtotalMinor: number;
  readonly orderNote: string | null;
  readonly createdAt: Instant;
  readonly processingOrderId: string | null;
  readonly processingStartedAt: Instant | null;
  readonly processingExpiresAt: Instant | null;
}

export interface OnlineOrderInboxStore {
  initialize(): Promise<void>;
  upsertMany(requests: readonly CachedOnlineOrderRequest[]): Promise<void>;
  list(shopId: ShopId): Promise<readonly CachedOnlineOrderRequest[]>;
  remove(shopId: ShopId, requestId: string): Promise<void>;
  close(): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Cached online-order request must be an object.');
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Cached online-order ${label} must be a UUID.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`Cached online-order ${label} is invalid.`);
  }
  return value;
}

function jsonArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Cached online-order trustedItems must be a non-empty array.');
  }
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    if (!Array.isArray(cloned) || cloned.length === 0) throw new Error('invalid clone');
    return cloned;
  } catch {
    throw new Error('Cached online-order trustedItems must be JSON-safe.');
  }
}

function parseInstant(value: unknown, label: string): Instant {
  if (typeof value !== 'string') {
    throw new Error(`Cached online-order ${label} must be an ISO instant.`);
  }
  try {
    return instant(value);
  } catch {
    throw new Error(`Cached online-order ${label} must be an ISO instant.`);
  }
}

function nullableInstant(value: unknown, label: string): Instant | null {
  return value === null ? null : parseInstant(value, label);
}

export function parseCachedOnlineOrderRequest(value: unknown): CachedOnlineOrderRequest {
  const source = record(value);
  const requestId = uuid(source.requestId, 'requestId');
  const shopIdValue = uuid(source.shopId, 'shopId');
  let shopId: ShopId;
  try {
    shopId = parseEntityId<ShopId>(shopIdValue);
  } catch {
    throw new Error('Cached online-order shopId must be a UUID.');
  }

  const status = source.status;
  if (status !== 'PENDING' && status !== 'PROCESSING') {
    throw new Error('Cached online-order status is invalid.');
  }
  const catalogRevision = source.catalogRevision;
  if (typeof catalogRevision !== 'string' || !REVISION_PATTERN.test(catalogRevision)) {
    throw new Error('Cached online-order catalogRevision is invalid.');
  }
  const fulfillmentPreference = source.fulfillmentPreference;
  if (fulfillmentPreference !== 'PICKUP' && fulfillmentPreference !== 'DELIVERY') {
    throw new Error('Cached online-order fulfillment preference is invalid.');
  }
  const paymentPreference = source.paymentPreference;
  if (
    paymentPreference !== 'CASH' &&
    paymentPreference !== 'INSTAPAY' &&
    paymentPreference !== 'MIXED'
  ) {
    throw new Error('Cached online-order payment preference is invalid.');
  }
  const customerName = source.customerName;
  if (
    typeof customerName !== 'string' ||
    customerName.trim().length === 0 ||
    customerName.length > 200
  ) {
    throw new Error('Cached online-order customerName is invalid.');
  }
  const normalizedPhone = nullableString(source.normalizedPhone, 'normalizedPhone', 50);
  if (normalizedPhone !== null && !NORMALIZED_PHONE_PATTERN.test(normalizedPhone)) {
    throw new Error('Cached online-order normalizedPhone is invalid.');
  }
  const deliveryAddress = nullableString(source.deliveryAddress, 'deliveryAddress', 500);
  const orderNote = nullableString(source.orderNote, 'orderNote', 1000);
  const itemsSubtotalMinor = source.itemsSubtotalMinor;
  if (
    typeof itemsSubtotalMinor !== 'number' ||
    !Number.isSafeInteger(itemsSubtotalMinor) ||
    itemsSubtotalMinor < 0
  ) {
    throw new Error('Cached online-order itemsSubtotalMinor is invalid.');
  }

  const createdAt = parseInstant(source.createdAt, 'createdAt');
  const processingOrderId =
    source.processingOrderId === null ? null : uuid(source.processingOrderId, 'processingOrderId');
  const processingStartedAt = nullableInstant(source.processingStartedAt, 'processingStartedAt');
  const processingExpiresAt = nullableInstant(source.processingExpiresAt, 'processingExpiresAt');

  if (
    status === 'PENDING' &&
    (processingOrderId !== null || processingStartedAt !== null || processingExpiresAt !== null)
  ) {
    throw new Error('Cached PENDING online order cannot contain processing authority.');
  }
  if (
    status === 'PROCESSING' &&
    (processingOrderId === null || processingStartedAt === null || processingExpiresAt === null)
  ) {
    throw new Error('Cached PROCESSING online order requires processing authority.');
  }
  if (
    processingStartedAt !== null &&
    processingExpiresAt !== null &&
    processingExpiresAt <= processingStartedAt
  ) {
    throw new Error('Cached online-order processing expiry must be after its start.');
  }

  return {
    requestId,
    shopId,
    status,
    catalogRevision,
    fulfillmentPreference,
    paymentPreference,
    customerName,
    normalizedPhone,
    deliveryAddress,
    trustedItems: jsonArray(source.trustedItems),
    itemsSubtotalMinor,
    orderNote,
    createdAt,
    processingOrderId,
    processingStartedAt,
    processingExpiresAt,
  };
}

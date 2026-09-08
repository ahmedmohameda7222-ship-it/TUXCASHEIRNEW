const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_BODY_BYTES = 16 * 1024;

export type OnlineOrderOperationsStoreErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID'
  | 'UNAVAILABLE';

export class OnlineOrderOperationsStoreError extends Error {
  constructor(readonly code: OnlineOrderOperationsStoreErrorCode) {
    super(code);
    this.name = 'OnlineOrderOperationsStoreError';
  }
}

export interface OnlineOrderOperationsStore {
  list(input: { authUserId: string; deviceId: string; limit: number }): Promise<unknown>;
  claim(input: { authUserId: string; deviceId: string; requestId: string }): Promise<unknown>;
  release(input: {
    authUserId: string;
    deviceId: string;
    requestId: string;
    processingOrderId: string;
  }): Promise<unknown>;
  reject(input: {
    authUserId: string;
    deviceId: string;
    requestId: string;
    reason: string;
  }): Promise<unknown>;
}

export interface OnlineOrderOperationsDependencies {
  authenticate(token: string): Promise<string | null>;
  readonly store: OnlineOrderOperationsStore;
}

interface PendingRequest {
  readonly requestId: string;
  readonly shopId: string;
  readonly status: 'PENDING' | 'PROCESSING';
  readonly catalogRevision: string;
  readonly fulfillmentPreference: 'PICKUP' | 'DELIVERY';
  readonly paymentPreference: 'CASH' | 'INSTAPAY' | 'MIXED';
  readonly customerName: string;
  readonly normalizedPhone: string | null;
  readonly deliveryAddress: string | null;
  readonly trustedItems: readonly unknown[];
  readonly itemsSubtotalMinor: number;
  readonly orderNote: string | null;
  readonly createdAt: string;
  readonly processingOrderId: string | null;
  readonly processingStartedAt: string | null;
  readonly processingExpiresAt: string | null;
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function nullableString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value;
}

function isoInstant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function parsePendingRequest(value: unknown): PendingRequest | null {
  const source = object(value);
  if (source === null) return null;
  const requestId = uuid(source.requestId);
  const shopId = uuid(source.shopId);
  const status = source.status;
  const catalogRevision = source.catalogRevision;
  const fulfillmentPreference = source.fulfillmentPreference;
  const paymentPreference = source.paymentPreference;
  const customerName = source.customerName;
  const normalizedPhone = nullableString(source.normalizedPhone, 50);
  const deliveryAddress = nullableString(source.deliveryAddress, 500);
  const orderNote = nullableString(source.orderNote, 1000);
  const createdAt = isoInstant(source.createdAt);
  const processingOrderId = source.processingOrderId === null ? null : uuid(source.processingOrderId);
  const processingStartedAt =
    source.processingStartedAt === null ? null : isoInstant(source.processingStartedAt);
  const processingExpiresAt =
    source.processingExpiresAt === null ? null : isoInstant(source.processingExpiresAt);
  const subtotal = source.itemsSubtotalMinor;
  if (
    requestId === null ||
    shopId === null ||
    (status !== 'PENDING' && status !== 'PROCESSING') ||
    typeof catalogRevision !== 'string' ||
    !REVISION_PATTERN.test(catalogRevision) ||
    (fulfillmentPreference !== 'PICKUP' && fulfillmentPreference !== 'DELIVERY') ||
    (paymentPreference !== 'CASH' &&
      paymentPreference !== 'INSTAPAY' &&
      paymentPreference !== 'MIXED') ||
    typeof customerName !== 'string' ||
    customerName.trim().length === 0 ||
    customerName.length > 200 ||
    normalizedPhone === undefined ||
    deliveryAddress === undefined ||
    orderNote === undefined ||
    !Array.isArray(source.trustedItems) ||
    typeof subtotal !== 'number' ||
    !Number.isSafeInteger(subtotal) ||
    subtotal < 0 ||
    createdAt === null
  ) {
    return null;
  }
  if (
    (status === 'PENDING' &&
      (processingOrderId !== null || processingStartedAt !== null || processingExpiresAt !== null)) ||
    (status === 'PROCESSING' &&
      (processingOrderId === null || processingStartedAt === null || processingExpiresAt === null))
  ) {
    return null;
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
    trustedItems: source.trustedItems,
    itemsSubtotalMinor: subtotal,
    orderNote,
    createdAt,
    processingOrderId,
    processingStartedAt,
    processingExpiresAt,
  };
}

function parseResolution(
  value: unknown,
  expectedStatus: 'PENDING' | 'REJECTED',
): { requestId: string; status: 'PENDING' | 'REJECTED' } | null {
  const source = object(value);
  if (source === null || !exactKeys(source, ['requestId', 'status'])) return null;
  const requestId = uuid(source.requestId);
  if (requestId === null || source.status !== expectedStatus) return null;
  return { requestId, status: expectedStatus };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')?.trim() ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function mapStoreError(error: unknown): Response {
  if (!(error instanceof OnlineOrderOperationsStoreError)) {
    return jsonResponse(502, { error: 'online_order_remote_failed' });
  }
  switch (error.code) {
    case 'FORBIDDEN':
      return jsonResponse(403, { error: 'device_not_authorized' });
    case 'NOT_FOUND':
      return jsonResponse(404, { error: 'online_order_not_found' });
    case 'CONFLICT':
      return jsonResponse(409, { error: 'online_order_conflict' });
    case 'INVALID':
      return jsonResponse(400, { error: 'invalid_online_order_operation' });
    case 'UNAVAILABLE':
      return jsonResponse(503, { error: 'online_order_remote_unavailable' });
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
    return object(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function handleOnlineOrderOperationsRequest(
  request: Request,
  dependencies: OnlineOrderOperationsDependencies,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const token = bearerToken(request);
  const deviceId = uuid(request.headers.get('x-tux-device-id'));
  if (token === null || deviceId === null) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  let authUserId: string | null;
  try {
    authUserId = await dependencies.authenticate(token);
  } catch {
    return jsonResponse(503, { error: 'device_authentication_unavailable' });
  }
  if (authUserId === null || uuid(authUserId) === null) {
    return jsonResponse(401, { error: 'invalid_access_token' });
  }

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => key !== 'limit')) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const raw = await dependencies.store.list({ authUserId, deviceId, limit });
      if (!Array.isArray(raw)) return jsonResponse(502, { error: 'invalid_remote_response' });
      const requests = raw.map(parsePendingRequest);
      if (requests.some((item) => item === null)) {
        return jsonResponse(502, { error: 'invalid_remote_response' });
      }
      return jsonResponse(200, { schemaVersion: 1, requests });
    }

    const body = await readBody(request);
    if (body === null || typeof body.action !== 'string') {
      return jsonResponse(400, { error: 'invalid_online_order_operation' });
    }

    if (body.action === 'CLAIM') {
      if (!exactKeys(body, ['action', 'requestId'])) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const requestId = uuid(body.requestId);
      if (requestId === null) return jsonResponse(400, { error: 'invalid_online_order_operation' });
      const claimed = parsePendingRequest(
        await dependencies.store.claim({ authUserId, deviceId, requestId }),
      );
      if (claimed === null || claimed.status !== 'PROCESSING') {
        return jsonResponse(502, { error: 'invalid_remote_response' });
      }
      return jsonResponse(200, { schemaVersion: 1, ...claimed });
    }

    if (body.action === 'RELEASE') {
      if (!exactKeys(body, ['action', 'requestId', 'processingOrderId'])) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const requestId = uuid(body.requestId);
      const processingOrderId = uuid(body.processingOrderId);
      if (requestId === null || processingOrderId === null) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const released = parseResolution(
        await dependencies.store.release({ authUserId, deviceId, requestId, processingOrderId }),
        'PENDING',
      );
      if (released === null) return jsonResponse(502, { error: 'invalid_remote_response' });
      return jsonResponse(200, { schemaVersion: 1, ...released });
    }

    if (body.action === 'REJECT') {
      if (!exactKeys(body, ['action', 'requestId', 'reason'])) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const requestId = uuid(body.requestId);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (requestId === null || reason.length === 0 || reason.length > 500) {
        return jsonResponse(400, { error: 'invalid_online_order_operation' });
      }
      const rejected = parseResolution(
        await dependencies.store.reject({ authUserId, deviceId, requestId, reason }),
        'REJECTED',
      );
      if (rejected === null) return jsonResponse(502, { error: 'invalid_remote_response' });
      return jsonResponse(200, { schemaVersion: 1, ...rejected });
    }

    return jsonResponse(400, { error: 'invalid_online_order_operation' });
  } catch (error) {
    return mapStoreError(error);
  }
}

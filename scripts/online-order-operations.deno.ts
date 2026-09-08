import {
  OnlineOrderOperationsStoreError,
  handleOnlineOrderOperationsRequest,
  type OnlineOrderOperationsStore,
} from '../supabase/functions/online-order-operations/online-order-operations.ts';

const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SHOP_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function pending(status: 'PENDING' | 'PROCESSING' = 'PENDING'): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    shopId: SHOP_ID,
    status,
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    customerName: 'Ahmed Mohamed',
    normalizedPhone: '01001234567',
    deliveryAddress: 'Nasr City, Cairo',
    trustedItems: [],
    itemsSubtotalMinor: 19000,
    orderNote: null,
    createdAt: '2026-09-08T10:00:00.000Z',
    processingOrderId: status === 'PROCESSING' ? ORDER_ID : null,
    processingStartedAt: status === 'PROCESSING' ? '2026-09-08T10:05:00.000Z' : null,
    processingExpiresAt: status === 'PROCESSING' ? '2026-09-08T22:05:00.000Z' : null,
  };
}

class MemoryStore implements OnlineOrderOperationsStore {
  readonly calls: Array<Record<string, unknown>> = [];
  failure: OnlineOrderOperationsStoreError | null = null;

  async list(input: { authUserId: string; deviceId: string; limit: number }): Promise<unknown> {
    this.calls.push({ action: 'LIST', ...input });
    if (this.failure) throw this.failure;
    return [pending()];
  }

  async claim(input: { authUserId: string; deviceId: string; requestId: string }): Promise<unknown> {
    this.calls.push({ action: 'CLAIM', ...input });
    if (this.failure) throw this.failure;
    return pending('PROCESSING');
  }

  async release(input: {
    authUserId: string;
    deviceId: string;
    requestId: string;
    processingOrderId: string;
  }): Promise<unknown> {
    this.calls.push({ action: 'RELEASE', ...input });
    if (this.failure) throw this.failure;
    return { requestId: REQUEST_ID, status: 'PENDING' };
  }

  async reject(input: {
    authUserId: string;
    deviceId: string;
    requestId: string;
    reason: string;
  }): Promise<unknown> {
    this.calls.push({ action: 'REJECT', ...input });
    if (this.failure) throw this.failure;
    return { requestId: REQUEST_ID, status: 'REJECTED' };
  }
}

function request(
  method: 'GET' | 'POST',
  payload?: unknown,
  options: { token?: string | null; deviceId?: string; query?: string } = {},
): Request {
  return new Request(`https://example.test/online-order-operations${options.query ?? ''}`, {
    method,
    headers: {
      ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? 'valid-token'}` }),
      ...((options.deviceId ?? DEVICE_ID).length === 0
        ? {}
        : { 'x-tux-device-id': options.deviceId ?? DEVICE_ID }),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
  });
}

const authenticate = async (token: string): Promise<string | null> =>
  token === 'valid-token' ? AUTH_USER_ID : null;

Deno.test('online-order operations requires an authenticated enrolled-device identity before store access', async () => {
  const store = new MemoryStore();
  const missing = await handleOnlineOrderOperationsRequest(
    request('GET', undefined, { token: null }),
    { authenticate, store },
  );
  assert(missing.status === 401, 'missing bearer must be rejected');
  assert(store.calls.length === 0, 'unauthenticated request reached store');

  const invalid = await handleOnlineOrderOperationsRequest(
    request('GET', undefined, { token: 'invalid-token' }),
    { authenticate, store },
  );
  assert(invalid.status === 401, 'invalid bearer must be rejected');
  assert(store.calls.length === 0, 'invalid bearer reached store');
});

Deno.test('online-order operations lists only through server-authorized auth-user/device scope', async () => {
  const store = new MemoryStore();
  const response = await handleOnlineOrderOperationsRequest(request('GET', undefined, { query: '?limit=25' }), {
    authenticate,
    store,
  });
  const parsed = await body(response);
  assert(response.status === 200, 'list failed');
  assert(parsed.schemaVersion === 1, 'schema version missing');
  assert(Array.isArray(parsed.requests) && parsed.requests.length === 1, 'pending list missing');
  assert(
    JSON.stringify(store.calls[0]) ===
      JSON.stringify({ action: 'LIST', authUserId: AUTH_USER_ID, deviceId: DEVICE_ID, limit: 25 }),
    'list did not preserve authenticated device scope',
  );
});

Deno.test('online-order operations CLAIM reserves the remote processing order identity', async () => {
  const store = new MemoryStore();
  const response = await handleOnlineOrderOperationsRequest(
    request('POST', { action: 'CLAIM', requestId: REQUEST_ID }),
    { authenticate, store },
  );
  const parsed = await body(response);
  assert(response.status === 200, 'claim failed');
  assert(parsed.status === 'PROCESSING', 'claim did not enter PROCESSING');
  assert(parsed.processingOrderId === ORDER_ID, 'claim did not expose reserved final order identity');
  assert(
    JSON.stringify(store.calls[0]) ===
      JSON.stringify({ action: 'CLAIM', authUserId: AUTH_USER_ID, deviceId: DEVICE_ID, requestId: REQUEST_ID }),
    'claim did not preserve authenticated identity',
  );
});

Deno.test('online-order operations RELEASE requires the exact reserved order identity', async () => {
  const store = new MemoryStore();
  const response = await handleOnlineOrderOperationsRequest(
    request('POST', { action: 'RELEASE', requestId: REQUEST_ID, processingOrderId: ORDER_ID }),
    { authenticate, store },
  );
  const parsed = await body(response);
  assert(response.status === 200 && parsed.status === 'PENDING', 'release failed');
  assert(store.calls[0]?.processingOrderId === ORDER_ID, 'release lost processing order identity');
});

Deno.test('online-order operations REJECT trims a bounded worker reason and never accepts client shop authority', async () => {
  const store = new MemoryStore();
  const response = await handleOnlineOrderOperationsRequest(
    request('POST', { action: 'REJECT', requestId: REQUEST_ID, reason: '  Customer unavailable  ' }),
    { authenticate, store },
  );
  const parsed = await body(response);
  assert(response.status === 200 && parsed.status === 'REJECTED', 'reject failed');
  assert(store.calls[0]?.reason === 'Customer unavailable', 'reject reason was not canonicalized');

  const forbiddenAuthority = await handleOnlineOrderOperationsRequest(
    request('POST', { action: 'CLAIM', requestId: REQUEST_ID, shopId: SHOP_ID }),
    { authenticate, store },
  );
  assert(forbiddenAuthority.status === 400, 'client shop authority must be rejected');
});

Deno.test('online-order operations maps device authorization and claim conflicts without leaking RPC details', async () => {
  const forbidden = new MemoryStore();
  forbidden.failure = new OnlineOrderOperationsStoreError('FORBIDDEN');
  const forbiddenResponse = await handleOnlineOrderOperationsRequest(request('GET'), {
    authenticate,
    store: forbidden,
  });
  assert(forbiddenResponse.status === 403, 'device authorization failure must be 403');
  assert((await body(forbiddenResponse)).error === 'device_not_authorized', 'wrong forbidden error');

  const conflict = new MemoryStore();
  conflict.failure = new OnlineOrderOperationsStoreError('CONFLICT');
  const conflictResponse = await handleOnlineOrderOperationsRequest(
    request('POST', { action: 'CLAIM', requestId: REQUEST_ID }),
    { authenticate, store: conflict },
  );
  assert(conflictResponse.status === 409, 'claim conflict must be 409');
  assert((await body(conflictResponse)).error === 'online_order_conflict', 'wrong conflict error');
});

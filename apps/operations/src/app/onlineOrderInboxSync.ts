import type { ShopId } from '@tux/domain';
import {
  parseCachedOnlineOrderRequest,
  type CachedOnlineOrderRequest,
  type OnlineOrderInboxStore,
} from '@tux/persistence';

const SNAPSHOT_LIMIT = 200;
const CLAIM_ENVELOPE_KEYS = [
  'schemaVersion',
  'requestId',
  'shopId',
  'status',
  'catalogRevision',
  'fulfillmentPreference',
  'paymentPreference',
  'customerName',
  'normalizedPhone',
  'deliveryAddress',
  'trustedItems',
  'itemsSubtotalMinor',
  'orderNote',
  'createdAt',
  'processingOrderId',
  'processingStartedAt',
  'processingExpiresAt',
  'processingDeviceId',
  'reservationOriginDeviceId',
] as const;
const REVIEW_ACK_KEYS = ['schemaVersion', 'requestId', 'status'] as const;

export interface OnlineOrderOperationsRemote {
  fetchActiveRequests(limit: number): Promise<unknown>;
}

interface OnlineOrderReviewRemote {
  claim(requestId: string): Promise<unknown>;
  release(requestId: string, processingOrderId: string): Promise<unknown>;
  reject(requestId: string, processingOrderId: string, reason: string): Promise<unknown>;
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Online-order inbox snapshot must be an object.');
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  source: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  if (Object.keys(source).length !== expected.length) return false;
  const accepted = new Set(expected);
  return Object.keys(source).every((key) => accepted.has(key));
}

function parseOnlineOrderInboxSnapshot(
  value: unknown,
  expectedShopId: ShopId,
): readonly CachedOnlineOrderRequest[] {
  const source = snapshotRecord(value);
  const keys = Object.keys(source);
  if (keys.some((key) => key !== 'schemaVersion' && key !== 'requests')) {
    throw new Error('Online-order inbox snapshot contains unexpected fields.');
  }
  if (source.schemaVersion !== 1) {
    throw new Error('Online-order inbox snapshot schemaVersion is invalid.');
  }
  if (!Array.isArray(source.requests)) {
    throw new Error('Online-order inbox snapshot requests must be an array.');
  }

  return source.requests.map((request) => {
    const parsed = parseCachedOnlineOrderRequest(request);
    if (parsed.shopId !== expectedShopId) {
      throw new Error('Online-order inbox snapshot contains a request for another shop.');
    }
    return parsed;
  });
}

function parseClaimResponse(input: {
  readonly value: unknown;
  readonly expectedShopId: ShopId;
  readonly expectedRequestId: string;
}): CachedOnlineOrderRequest {
  const source = snapshotRecord(input.value);
  if (!hasExactKeys(source, CLAIM_ENVELOPE_KEYS) || source.schemaVersion !== 1) {
    throw new Error('Online-order claim response is invalid.');
  }

  const cachedValue = { ...source };
  delete cachedValue.schemaVersion;
  const parsed = parseCachedOnlineOrderRequest(cachedValue);
  if (parsed.shopId !== input.expectedShopId) {
    throw new Error('Online-order claim response is for another shop.');
  }
  if (parsed.requestId !== input.expectedRequestId) {
    throw new Error('Online-order claim response is for another request.');
  }
  if (parsed.status !== 'PROCESSING') {
    throw new Error('Online-order claim response must be PROCESSING.');
  }
  return parsed;
}

function parseReviewAck(input: {
  readonly value: unknown;
  readonly expectedRequestId: string;
  readonly expectedStatus: 'PENDING' | 'REJECTED';
}): void {
  const source = snapshotRecord(input.value);
  if (!hasExactKeys(source, REVIEW_ACK_KEYS) || source.schemaVersion !== 1) {
    throw new Error('Online-order review acknowledgement is invalid.');
  }
  if (source.requestId !== input.expectedRequestId) {
    throw new Error('Online-order review acknowledgement is for another request.');
  }
  if (source.status !== input.expectedStatus) {
    throw new Error(`Online-order review acknowledgement must be ${input.expectedStatus}.`);
  }
}

async function cachedRequestForReview(input: {
  readonly shopId: ShopId;
  readonly requestId: string;
  readonly store: OnlineOrderInboxStore;
}): Promise<CachedOnlineOrderRequest> {
  const request = (await input.store.list(input.shopId)).find(
    (candidate) => candidate.requestId === input.requestId,
  );
  if (request === undefined) {
    throw new Error('Online-order review request is not present in the local inbox.');
  }
  return request;
}

async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers:
      body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Online-order Operations remote returned invalid JSON.');
  }

  if (!response.ok) {
    throw new Error(`Online-order Operations remote failed with HTTP ${response.status}.`);
  }
  return payload;
}

export async function syncOnlineOrderInboxSnapshot(input: {
  readonly shopId: ShopId;
  readonly store: OnlineOrderInboxStore;
  readonly remote: OnlineOrderOperationsRemote;
}): Promise<readonly CachedOnlineOrderRequest[]> {
  const payload = await input.remote.fetchActiveRequests(SNAPSHOT_LIMIT);
  const remoteRequests = parseOnlineOrderInboxSnapshot(payload, input.shopId);
  const cachedRequests = await input.store.list(input.shopId);
  const remoteIds = new Set(remoteRequests.map((request) => request.requestId));

  await input.store.upsertMany(remoteRequests);
  for (const cached of cachedRequests) {
    if (!remoteIds.has(cached.requestId)) {
      await input.store.remove(input.shopId, cached.requestId);
    }
  }

  return remoteRequests;
}

export async function claimOnlineOrderForReview(input: {
  readonly shopId: ShopId;
  readonly requestId: string;
  readonly store: OnlineOrderInboxStore;
  readonly remote: Pick<OnlineOrderReviewRemote, 'claim'>;
}): Promise<CachedOnlineOrderRequest> {
  const claimed = parseClaimResponse({
    value: await input.remote.claim(input.requestId),
    expectedShopId: input.shopId,
    expectedRequestId: input.requestId,
  });
  await input.store.upsertMany([claimed]);
  return claimed;
}

export async function releaseOnlineOrderReview(input: {
  readonly shopId: ShopId;
  readonly requestId: string;
  readonly processingOrderId: string;
  readonly store: OnlineOrderInboxStore;
  readonly remote: Pick<OnlineOrderReviewRemote, 'release'>;
}): Promise<CachedOnlineOrderRequest> {
  const cached = await cachedRequestForReview(input);
  if (cached.status !== 'PROCESSING' || cached.processingOrderId !== input.processingOrderId) {
    throw new Error('Online-order review release does not match the local processing claim.');
  }

  parseReviewAck({
    value: await input.remote.release(input.requestId, input.processingOrderId),
    expectedRequestId: input.requestId,
    expectedStatus: 'PENDING',
  });

  const released: CachedOnlineOrderRequest = {
    ...cached,
    status: 'PENDING',
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
    processingDeviceId: null,
    reservationOriginDeviceId: null,
  };
  await input.store.upsertMany([released]);
  return released;
}

export async function rejectOnlineOrderRequest(input: {
  readonly shopId: ShopId;
  readonly requestId: string;
  readonly processingOrderId: string;
  readonly reason: string;
  readonly store: OnlineOrderInboxStore;
  readonly remote: Pick<OnlineOrderReviewRemote, 'reject'>;
}): Promise<void> {
  const cached = await cachedRequestForReview(input);
  if (cached.status !== 'PROCESSING' || cached.processingOrderId !== input.processingOrderId) {
    throw new Error('Online-order rejection does not match the local processing claim.');
  }
  parseReviewAck({
    value: await input.remote.reject(input.requestId, input.processingOrderId, input.reason),
    expectedRequestId: input.requestId,
    expectedStatus: 'REJECTED',
  });
  await input.store.remove(input.shopId, input.requestId);
}

export class BrowserOnlineOrderOperationsRemote
  implements OnlineOrderOperationsRemote, OnlineOrderReviewRemote
{
  async fetchActiveRequests(limit: number): Promise<unknown> {
    return requestJson(
      'GET',
      `${window.location.origin}/api/online-order-operations?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async claim(requestId: string): Promise<unknown> {
    return requestJson('POST', `${window.location.origin}/api/online-order-operations`, {
      action: 'CLAIM',
      requestId,
    });
  }

  async release(requestId: string, processingOrderId: string): Promise<unknown> {
    return requestJson('POST', `${window.location.origin}/api/online-order-operations`, {
      action: 'RELEASE',
      requestId,
      processingOrderId,
    });
  }

  async reject(requestId: string, processingOrderId: string, reason: string): Promise<unknown> {
    return requestJson('POST', `${window.location.origin}/api/online-order-operations`, {
      action: 'REJECT',
      requestId,
      processingOrderId,
      reason,
    });
  }
}

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
] as const;
const REVIEW_ACK_KEYS = ['schemaVersion', 'requestId', 'status'] as const;
const REMOTE_UNAVAILABLE_MESSAGE = 'Online orders could not refresh. Showing the saved inbox.';

export type OnlineOrderInboxSyncState = 'CACHED' | 'SYNCED' | 'REMOTE_UNAVAILABLE';

export interface OnlineOrderInboxSnapshot {
  readonly requests: readonly CachedOnlineOrderRequest[];
  readonly syncState: OnlineOrderInboxSyncState;
  readonly errorMessage: string | null;
}

export interface OnlineOrderInboxRemoteGateway {
  fetchActiveRequests(limit: number): Promise<unknown>;
  claim(requestId: string): Promise<unknown>;
  release(requestId: string, processingOrderId: string): Promise<unknown>;
  reject(requestId: string, reason: string): Promise<unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
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

function parseSnapshot(
  value: unknown,
  expectedShopId: ShopId,
): readonly CachedOnlineOrderRequest[] {
  const source = record(value, 'Online-order inbox snapshot');
  if (!hasExactKeys(source, ['schemaVersion', 'requests']) || source.schemaVersion !== 1) {
    throw new Error('Online-order inbox snapshot is invalid.');
  }
  if (!Array.isArray(source.requests)) {
    throw new Error('Online-order inbox snapshot requests must be an array.');
  }
  return source.requests.map((candidate) => {
    const parsed = parseCachedOnlineOrderRequest(candidate);
    if (parsed.shopId !== expectedShopId) {
      throw new Error('Online-order inbox snapshot contains a request for another shop.');
    }
    return parsed;
  });
}

function parseClaim(value: unknown, expectedShopId: ShopId, expectedRequestId: string) {
  const source = record(value, 'Online-order claim response');
  if (!hasExactKeys(source, CLAIM_ENVELOPE_KEYS) || source.schemaVersion !== 1) {
    throw new Error('Online-order claim response is invalid.');
  }
  const cachedValue = { ...source };
  delete cachedValue.schemaVersion;
  const parsed = parseCachedOnlineOrderRequest(cachedValue);
  if (parsed.shopId !== expectedShopId) {
    throw new Error('Online-order claim response is for another shop.');
  }
  if (parsed.requestId !== expectedRequestId) {
    throw new Error('Online-order claim response is for another request.');
  }
  if (parsed.status !== 'PROCESSING') {
    throw new Error('Online-order claim response must be PROCESSING.');
  }
  return parsed;
}

function parseAck(
  value: unknown,
  expectedRequestId: string,
  expectedStatus: 'PENDING' | 'REJECTED',
): void {
  const source = record(value, 'Online-order review acknowledgement');
  if (!hasExactKeys(source, REVIEW_ACK_KEYS) || source.schemaVersion !== 1) {
    throw new Error('Online-order review acknowledgement is invalid.');
  }
  if (source.requestId !== expectedRequestId) {
    throw new Error('Online-order review acknowledgement is for another request.');
  }
  if (source.status !== expectedStatus) {
    throw new Error(`Online-order review acknowledgement must be ${expectedStatus}.`);
  }
}

export class OperationsOnlineOrderInboxService {
  readonly #getActiveShopId: () => Promise<ShopId>;
  readonly #store: OnlineOrderInboxStore;
  readonly #remote: OnlineOrderInboxRemoteGateway;
  readonly #listeners = new Set<(snapshot: OnlineOrderInboxSnapshot) => void>();

  constructor(input: {
    readonly getActiveShopId: () => Promise<ShopId>;
    readonly store: OnlineOrderInboxStore;
    readonly remote: OnlineOrderInboxRemoteGateway;
  }) {
    this.#getActiveShopId = input.getActiveShopId;
    this.#store = input.store;
    this.#remote = input.remote;
  }

  subscribe(listener: (snapshot: OnlineOrderInboxSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async load(): Promise<OnlineOrderInboxSnapshot> {
    const shopId = await this.#getActiveShopId();
    this.#publish({
      requests: await this.#store.list(shopId),
      syncState: 'CACHED',
      errorMessage: null,
    });
    try {
      const remote = parseSnapshot(await this.#remote.fetchActiveRequests(SNAPSHOT_LIMIT), shopId);
      const cached = await this.#store.list(shopId);
      const remoteIds = new Set(remote.map((request) => request.requestId));
      await this.#store.upsertMany(remote);
      for (const request of cached) {
        if (!remoteIds.has(request.requestId)) await this.#store.remove(shopId, request.requestId);
      }
      return this.#publishSynced(shopId);
    } catch {
      const snapshot: OnlineOrderInboxSnapshot = {
        requests: await this.#store.list(shopId),
        syncState: 'REMOTE_UNAVAILABLE',
        errorMessage: REMOTE_UNAVAILABLE_MESSAGE,
      };
      this.#publish(snapshot);
      return snapshot;
    }
  }

  async claim(requestId: string): Promise<CachedOnlineOrderRequest> {
    const shopId = await this.#getActiveShopId();
    const claimed = parseClaim(await this.#remote.claim(requestId), shopId, requestId);
    await this.#store.upsertMany([claimed]);
    await this.#publishSynced(shopId);
    return claimed;
  }

  async release(requestId: string, processingOrderId: string): Promise<CachedOnlineOrderRequest> {
    const shopId = await this.#getActiveShopId();
    const cached = await this.#cachedRequest(shopId, requestId);
    if (cached.status !== 'PROCESSING' || cached.processingOrderId !== processingOrderId) {
      throw new Error('Online-order review release does not match the local processing claim.');
    }
    parseAck(await this.#remote.release(requestId, processingOrderId), requestId, 'PENDING');
    const released: CachedOnlineOrderRequest = {
      ...cached,
      status: 'PENDING',
      processingOrderId: null,
      processingStartedAt: null,
      processingExpiresAt: null,
    };
    await this.#store.upsertMany([released]);
    await this.#publishSynced(shopId);
    return released;
  }

  async reject(requestId: string, processingOrderId: string, reason: string): Promise<void> {
    const shopId = await this.#getActiveShopId();
    const cached = await this.#cachedRequest(shopId, requestId);
    if (cached.status !== 'PROCESSING' || cached.processingOrderId !== processingOrderId) {
      throw new Error('Online-order rejection does not match the local processing claim.');
    }
    parseAck(await this.#remote.reject(requestId, reason), requestId, 'REJECTED');
    await this.#store.remove(shopId, requestId);
    await this.#publishSynced(shopId);
  }

  async #cachedRequest(shopId: ShopId, requestId: string): Promise<CachedOnlineOrderRequest> {
    const request = (await this.#store.list(shopId)).find(
      (candidate) => candidate.requestId === requestId,
    );
    if (request === undefined) {
      throw new Error('Online-order review request is not present in the local inbox.');
    }
    return request;
  }

  async #publishSynced(shopId: ShopId): Promise<OnlineOrderInboxSnapshot> {
    const snapshot: OnlineOrderInboxSnapshot = {
      requests: await this.#store.list(shopId),
      syncState: 'SYNCED',
      errorMessage: null,
    };
    this.#publish(snapshot);
    return snapshot;
  }

  #publish(snapshot: OnlineOrderInboxSnapshot): void {
    for (const listener of this.#listeners) listener(snapshot);
  }
}

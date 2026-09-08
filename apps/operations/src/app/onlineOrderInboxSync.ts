import type { ShopId } from '@tux/domain';
import {
  parseCachedOnlineOrderRequest,
  type CachedOnlineOrderRequest,
  type OnlineOrderInboxStore,
} from '@tux/persistence';

const SNAPSHOT_LIMIT = 200;

export interface OnlineOrderOperationsRemote {
  fetchActiveRequests(limit: number): Promise<unknown>;
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Online-order inbox snapshot must be an object.');
  }
  return value as Record<string, unknown>;
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

export class BrowserOnlineOrderOperationsRemote implements OnlineOrderOperationsRemote {
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

  async reject(requestId: string, reason: string): Promise<unknown> {
    return requestJson('POST', `${window.location.origin}/api/online-order-operations`, {
      action: 'REJECT',
      requestId,
      reason,
    });
  }
}

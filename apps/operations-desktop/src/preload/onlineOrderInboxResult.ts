import type { OnlineOrderInboxSnapshot } from '@tux/application';
import { parseCachedOnlineOrderRequest, type CachedOnlineOrderRequest } from '@tux/persistence';

const SYNC_STATES = new Set<OnlineOrderInboxSnapshot['syncState']>([
  'CACHED',
  'SYNCED',
  'REMOTE_UNAVAILABLE',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  source: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(source).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new TypeError(`${label} contains unexpected fields.`);
  }
}

export function assertOnlineOrderInboxRequest(value: unknown): CachedOnlineOrderRequest {
  try {
    return parseCachedOnlineOrderRequest(value);
  } catch {
    throw new TypeError('Invalid online-order response from Electron main process.');
  }
}

export function assertOnlineOrderInboxSnapshot(value: unknown): OnlineOrderInboxSnapshot {
  const source = record(value, 'Online-order inbox response');
  exactKeys(source, ['requests', 'syncState', 'errorMessage'], 'Online-order inbox response');

  if (!Array.isArray(source.requests)) {
    throw new TypeError('Online-order inbox requests must be an array.');
  }

  if (typeof source.syncState !== 'string' || !SYNC_STATES.has(source.syncState as never)) {
    throw new TypeError('Online-order inbox sync state is invalid.');
  }

  if (source.errorMessage !== null && typeof source.errorMessage !== 'string') {
    throw new TypeError('Online-order inbox error message is invalid.');
  }

  return {
    requests: source.requests.map(assertOnlineOrderInboxRequest),
    syncState: source.syncState as OnlineOrderInboxSnapshot['syncState'],
    errorMessage: source.errorMessage as string | null,
  };
}

export function assertOnlineOrderInboxVoidResult(value: unknown): void {
  if (value !== undefined) {
    throw new TypeError('Invalid online-order void response from Electron main process.');
  }
}

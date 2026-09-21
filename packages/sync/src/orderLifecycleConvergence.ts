import {
  instant,
  parseEntityId,
  type Instant,
  type OrderId,
  type OrderReasonCodeSnapshot,
  type OrderSnapshot,
  type OrderStatus,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';

export interface OrderLifecycleFeedEvent {
  readonly sequence: number;
  readonly orderId: OrderId;
  readonly operationalRevision: number;
  readonly status: OrderStatus;
  readonly eventType:
    | 'MARKED_DONE'
    | 'DONE_UNDONE'
    | 'CANCELLED'
    | 'DELIVERY_RETURNED'
    | 'PLACED';
  readonly occurredAt: Instant;
  readonly workerId: WorkerId | null;
  readonly workerName: string | null;
  readonly adminEmployeeId: string | null;
  readonly foodPrepared: boolean | null;
  readonly stockRestored?: boolean | null;
  readonly reason: OrderReasonCodeSnapshot | null;
  readonly reasonLabel?: string | null;
  readonly note: string | null;
}

export interface OrderLifecycleFeedPage {
  readonly shopId: ShopId;
  readonly events: readonly OrderLifecycleFeedEvent[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface OrderLifecycleFeedTransport {
  pull(shopId: ShopId, cursor: string | null): Promise<OrderLifecycleFeedPage>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, label);
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean or null.`);
  return value;
}

function parseStatus(value: unknown): OrderStatus {
  if (value === 'ACTIVE' || value === 'DONE' || value === 'CANCELLED' || value === 'RETURNED') {
    return value;
  }
  throw new TypeError('Order lifecycle status is unsupported.');
}

function parseEventType(value: unknown): OrderLifecycleFeedEvent['eventType'] {
  if (
    value === 'MARKED_DONE' ||
    value === 'DONE_UNDONE' ||
    value === 'CANCELLED' ||
    value === 'DELIVERY_RETURNED' ||
    value === 'PLACED'
  ) {
    return value;
  }
  throw new TypeError('Order lifecycle event type is unsupported.');
}

function parseReason(value: unknown): OrderReasonCodeSnapshot | null {
  if (value === null || value === undefined) return null;
  const row = object(value, 'Order lifecycle reason');
  const family = row['family'];
  if (
    family !== 'CANCELLATION' &&
    family !== 'REFUND_RETURN' &&
    family !== 'DISCOUNT_COMP' &&
    family !== 'CASH_VARIANCE'
  ) {
    throw new TypeError('Order lifecycle reason family is unsupported.');
  }
  const scope = row['scope'];
  if (scope !== 'BUSINESS' && scope !== 'SHOP') {
    throw new TypeError('Order lifecycle reason scope is unsupported.');
  }
  const version = safeInteger(row['version'], 'Order lifecycle reason version');
  if (version < 1) throw new TypeError('Order lifecycle reason version must be positive.');
  return {
    id: stringValue(row['id'], 'Order lifecycle reason id'),
    key: stringValue(row['key'], 'Order lifecycle reason key'),
    label: stringValue(row['label'], 'Order lifecycle reason label'),
    family,
    version,
    scope,
  };
}

function parseEvent(value: unknown): OrderLifecycleFeedEvent {
  const row = object(value, 'Order lifecycle feed event');
  const rawWorker = row['workerId'];
  return {
    sequence: safeInteger(row['sequence'], 'Order lifecycle sequence'),
    orderId: parseEntityId<OrderId>(stringValue(row['orderId'], 'Order lifecycle order id')),
    operationalRevision: safeInteger(
      row['operationalRevision'],
      'Order lifecycle operational revision',
    ),
    status: parseStatus(row['status']),
    eventType: parseEventType(row['eventType']),
    occurredAt: instant(stringValue(row['occurredAt'], 'Order lifecycle occurred at')),
    workerId:
      rawWorker === null || rawWorker === undefined
        ? null
        : parseEntityId<WorkerId>(stringValue(rawWorker, 'Order lifecycle worker id')),
    workerName: optionalString(row['workerName'], 'Order lifecycle worker name'),
    adminEmployeeId: optionalString(
      row['adminEmployeeId'],
      'Order lifecycle Admin employee id',
    ),
    foodPrepared: nullableBoolean(row['foodPrepared'], 'Order lifecycle food prepared'),
    stockRestored: nullableBoolean(row['stockRestored'], 'Order lifecycle stock restored'),
    reason: parseReason(row['reason']),
    reasonLabel: optionalString(row['reasonLabel'], 'Order lifecycle reason label'),
    note: optionalString(row['note'], 'Order lifecycle note'),
  };
}

export interface HttpOrderLifecycleFeedTransportOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly headerProvider?: () =>
    | Readonly<Record<string, string>>
    | Promise<Readonly<Record<string, string>>>;
  readonly fetcher?: typeof fetch;
}

export class HttpOrderLifecycleFeedTransport implements OrderLifecycleFeedTransport {
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #headerProvider:
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>)
    | null;
  readonly #fetcher: typeof fetch;

  constructor(options: HttpOrderLifecycleFeedTransportOptions) {
    const url = new URL(options.endpoint);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !loopback) {
      throw new TypeError('Order lifecycle feed endpoint must use HTTPS outside loopback.');
    }
    this.#endpoint = url.toString();
    this.#headers = options.headers ?? {};
    this.#headerProvider = options.headerProvider ?? null;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async pull(shopId: ShopId, cursor: string | null): Promise<OrderLifecycleFeedPage> {
    const target = new URL(this.#endpoint);
    target.searchParams.set('shopId', shopId);
    if (cursor !== null) target.searchParams.set('cursor', cursor);
    const dynamicHeaders = (await this.#headerProvider?.()) ?? {};
    const sameOrigin =
      typeof globalThis.location !== 'undefined' && target.origin === globalThis.location.origin;
    const response = await this.#fetcher(target, {
      method: 'GET',
      headers: { accept: 'application/json', ...this.#headers, ...dynamicHeaders },
      ...(sameOrigin ? { credentials: 'same-origin' as const } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Order lifecycle convergence request failed with HTTP ${response.status}.`);
    }

    const body = object(await response.json(), 'Order lifecycle convergence response');
    const responseShopId = parseEntityId<ShopId>(
      stringValue(body['shopId'], 'Order lifecycle convergence shop'),
    );
    const rawEvents = body['events'];
    if (!Array.isArray(rawEvents)) {
      throw new TypeError('Order lifecycle convergence events are invalid.');
    }
    if (typeof body['hasMore'] !== 'boolean') {
      throw new TypeError('Order lifecycle convergence hasMore is invalid.');
    }
    const nextCursor =
      body['nextCursor'] === null
        ? null
        : stringValue(body['nextCursor'], 'Order lifecycle convergence cursor');

    return {
      shopId: responseShopId,
      events: rawEvents.map(parseEvent),
      nextCursor,
      hasMore: body['hasMore'],
    };
  }
}

function currentRevision(order: OrderSnapshot): number {
  return order.lifecycle?.revision ?? 0;
}

function reasonText(event: OrderLifecycleFeedEvent): string {
  const value = event.reason?.label ?? event.reasonLabel ?? '';
  if (value.trim() === '') throw new Error('Canonical lifecycle reason is missing.');
  return value;
}

function applyCanonicalEvent(
  order: OrderSnapshot,
  event: OrderLifecycleFeedEvent,
): OrderSnapshot {
  const current =
    order.lifecycle ?? {
      revision: 0,
      doneAt: null,
      cancellation: null,
      returned: null,
    };
  if (event.operationalRevision <= current.revision) return order;

  const actorName = event.workerName ?? (event.adminEmployeeId ? 'Admin' : 'System');
  switch (event.eventType) {
    case 'PLACED':
      return order;
    case 'MARKED_DONE':
      return {
        ...order,
        status: event.status,
        lifecycle: {
          ...current,
          revision: event.operationalRevision,
          doneAt: event.occurredAt,
        },
      };
    case 'DONE_UNDONE':
      return {
        ...order,
        status: event.status,
        lifecycle: {
          ...current,
          revision: event.operationalRevision,
          doneAt: null,
        },
      };
    case 'CANCELLED': {
      const foodPrepared = event.foodPrepared ?? false;
      return {
        ...order,
        status: event.status,
        lifecycle: {
          ...current,
          revision: event.operationalRevision,
          doneAt: null,
          cancellation: {
            at: event.occurredAt,
            workerId: event.workerId,
            workerName: actorName,
            ...(event.adminEmployeeId ? { adminEmployeeId: event.adminEmployeeId } : {}),
            foodPrepared,
            stockRestored: event.stockRestored ?? !foodPrepared,
            reason: reasonText(event),
            ...(event.reason ? { reasonCode: event.reason } : {}),
            ...(event.note ? { note: event.note } : {}),
          },
        },
      };
    }
    case 'DELIVERY_RETURNED':
      return {
        ...order,
        status: event.status,
        lifecycle: {
          ...current,
          revision: event.operationalRevision,
          returned: {
            at: event.occurredAt,
            workerId: event.workerId,
            workerName: actorName,
            ...(event.adminEmployeeId ? { adminEmployeeId: event.adminEmployeeId } : {}),
            reason: reasonText(event),
            ...(event.reason ? { reasonCode: event.reason } : {}),
            ...(event.note ? { note: event.note } : {}),
          },
        },
      };
  }
}

export class OrderLifecycleConvergenceService {
  readonly #database: OperationsDatabase;
  readonly #transport: OrderLifecycleFeedTransport;

  constructor(database: OperationsDatabase, transport: OrderLifecycleFeedTransport) {
    this.#database = database;
    this.#transport = transport;
  }

  async syncShop(shopId: ShopId, maxPages = 20): Promise<number> {
    if (!Number.isSafeInteger(maxPages) || maxPages <= 0 || maxPages > 100) {
      throw new RangeError('Order lifecycle convergence maxPages must be between 1 and 100.');
    }
    let applied = 0;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const cursor = await this.#database.transaction((transaction) =>
        transaction.orders.getLifecycleSyncCursor(shopId),
      );
      const page = await this.#transport.pull(shopId, cursor);
      if (page.shopId !== shopId) throw new Error('Order lifecycle convergence shop mismatch.');

      await this.#database.transaction(async (transaction) => {
        for (const event of page.events) {
          const existing = await transaction.orders.getById(event.orderId);
          if (existing === null || existing.shopId !== shopId) continue;
          if (event.operationalRevision <= currentRevision(existing)) continue;
          const updated = applyCanonicalEvent(existing, event);
          if (updated !== existing) {
            await transaction.orders.updateOperationalState(updated);
            applied += 1;
          }
        }
        if (page.nextCursor !== null) {
          await transaction.orders.setLifecycleSyncCursor(shopId, page.nextCursor);
        }
      });

      if (!page.hasMore || page.nextCursor === null || page.nextCursor === cursor) break;
    }
    return applied;
  }
}

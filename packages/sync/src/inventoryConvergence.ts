import {
  instant,
  parseEntityId,
  stockQuantityMicros,
  type InventoryItem,
  type InventoryMovement,
  type InventoryMovementId,
  type InventoryMovementType,
  type OrderId,
  type ShopId,
  type WorkerId,
  type BusinessDayId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';

const MOVEMENT_TYPES = new Set<InventoryMovementType>([
  'ORDER_RESERVATION',
  'ORDER_RESERVATION_RELEASE',
  'ORDER_CONSUMPTION',
  'ORDER_CONSUMPTION_REVERSAL',
  'CANCEL_RESTOCK',
  'BULK_UNIT_FINISHED',
  'BULK_STOCK_RECEIVED',
  'UNDO_BULK_UNIT_FINISHED',
  'UNDO_BULK_STOCK_RECEIVED',
  'ADMIN_ADJUSTMENT',
  'WASTE',
  'STOCKTAKE_ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
]);

export interface InventoryCostProjection {
  readonly itemId: InventoryItem['id'];
  readonly weightedUnitCostMinor: number;
}

export interface InventoryConvergencePage {
  readonly shopId: ShopId;
  readonly items: readonly InventoryItem[];
  readonly movements: readonly InventoryMovement[];
  readonly costs: readonly InventoryCostProjection[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface InventoryFeedTransport {
  pull(shopId: ShopId, cursor: string | null): Promise<InventoryConvergencePage>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function nullableEntityId<Id extends string>(value: unknown, label: string): Id | null {
  if (value === null) return null;
  return parseEntityId<Id>(stringValue(value, label));
}

function parseMovement(value: unknown): InventoryMovement {
  const source = object(value, 'Inventory feed movement');
  const type = stringValue(source['movementType'], 'Inventory movement type');
  if (!MOVEMENT_TYPES.has(type as InventoryMovementType)) {
    throw new TypeError('Inventory feed movement type is unsupported.');
  }
  const rawCost = source['unitCostMinor'];
  const unitCostMinor =
    rawCost === null || rawCost === undefined
      ? undefined
      : nonNegativeFinite(rawCost, 'Inventory movement unit cost');
  return {
    id: parseEntityId<InventoryMovementId>(stringValue(source['id'], 'Inventory movement id')),
    shopId: parseEntityId<ShopId>(stringValue(source['shopId'], 'Inventory movement shop')),
    businessDayId: nullableEntityId<BusinessDayId>(
      source['businessDayId'],
      'Inventory movement Business Day',
    ),
    itemId: parseEntityId<InventoryItem['id']>(
      stringValue(source['itemId'], 'Inventory movement item'),
    ),
    movementType: type as InventoryMovementType,
    quantityDeltaMicros: stockQuantityMicros(
      safeInteger(source['quantityDeltaMicros'], 'Inventory quantity delta'),
    ),
    reservedDeltaMicros: stockQuantityMicros(
      safeInteger(source['reservedDeltaMicros'] ?? 0, 'Inventory reservation delta'),
    ),
    idempotencyKey: stringValue(source['idempotencyKey'], 'Inventory idempotency key'),
    workerId: nullableEntityId<WorkerId>(source['workerId'], 'Inventory worker'),
    ...(unitCostMinor === undefined ? {} : { unitCostMinor }),
    orderId: nullableEntityId<OrderId>(source['orderId'], 'Inventory order'),
    createdAt: instant(stringValue(source['createdAt'], 'Inventory movement timestamp')),
    compensatesMovementId: nullableEntityId<InventoryMovementId>(
      source['compensatesMovementId'],
      'Inventory compensating movement',
    ),
  };
}

function parseItem(value: unknown): InventoryItem {
  const source = object(value, 'Inventory feed item');
  const trackingMode = source['trackingMode'];
  if (trackingMode !== 'RECIPE_TRACKED' && trackingMode !== 'BULK_MANUAL') {
    throw new TypeError('Inventory feed tracking mode is unsupported.');
  }
  if (typeof source['active'] !== 'boolean') throw new TypeError('Inventory item active is invalid.');
  return {
    id: parseEntityId<InventoryItem['id']>(stringValue(source['id'], 'Inventory item id')),
    shopId: parseEntityId<ShopId>(stringValue(source['shopId'], 'Inventory item shop')),
    name: stringValue(source['name'], 'Inventory item name'),
    unitLabel: stringValue(source['unitLabel'], 'Inventory item unit'),
    trackingMode,
    active: source['active'],
  };
}

export interface HttpInventoryFeedTransportOptions {
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly headerProvider?: () =>
    Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
  readonly fetcher?: typeof fetch;
}

export class HttpInventoryFeedTransport implements InventoryFeedTransport {
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #headerProvider:
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>)
    | null;
  readonly #fetcher: typeof fetch;

  constructor(options: HttpInventoryFeedTransportOptions) {
    const url = new URL(options.endpoint);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !loopback) {
      throw new TypeError('Inventory feed endpoint must use HTTPS outside loopback development.');
    }
    this.#endpoint = url.toString();
    this.#headers = options.headers ?? {};
    this.#headerProvider = options.headerProvider ?? null;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async pull(shopId: ShopId, cursor: string | null): Promise<InventoryConvergencePage> {
    const target = new URL(this.#endpoint);
    target.searchParams.set('shopId', shopId);
    if (cursor !== null) target.searchParams.set('cursor', cursor);
    const dynamicHeaders = (await this.#headerProvider?.()) ?? {};
    const response = await this.#fetcher(target, {
      method: 'GET',
      headers: { accept: 'application/json', ...this.#headers, ...dynamicHeaders },
      credentials: target.origin === globalThis.location?.origin ? 'same-origin' : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Inventory convergence request failed with HTTP ${response.status}.`);
    }
    const source = object(await response.json(), 'Inventory convergence response');
    const responseShopId = parseEntityId<ShopId>(
      stringValue(source['shopId'], 'Inventory convergence shop'),
    );
    const rawItems = source['items'];
    const rawMovements = source['movements'];
    const rawCosts = source['costs'];
    if (!Array.isArray(rawItems) || !Array.isArray(rawMovements) || !Array.isArray(rawCosts)) {
      throw new TypeError('Inventory convergence response arrays are invalid.');
    }
    const nextCursor =
      source['nextCursor'] === null
        ? null
        : stringValue(source['nextCursor'], 'Inventory convergence cursor');
    if (typeof source['hasMore'] !== 'boolean') {
      throw new TypeError('Inventory convergence hasMore is invalid.');
    }
    return {
      shopId: responseShopId,
      items: rawItems.map(parseItem),
      movements: rawMovements.map(parseMovement),
      costs: rawCosts.map((value) => {
        const row = object(value, 'Inventory convergence cost');
        return {
          itemId: parseEntityId<InventoryItem['id']>(
            stringValue(row['itemId'], 'Inventory cost item'),
          ),
          weightedUnitCostMinor: nonNegativeFinite(
            row['weightedUnitCostMinor'],
            'Inventory weighted cost',
          ),
        };
      }),
      nextCursor,
      hasMore: source['hasMore'],
    };
  }
}

export class InventoryConvergenceService {
  readonly #database: OperationsDatabase;
  readonly #transport: InventoryFeedTransport;

  constructor(database: OperationsDatabase, transport: InventoryFeedTransport) {
    this.#database = database;
    this.#transport = transport;
  }

  async syncShop(shopId: ShopId, maxPages = 20): Promise<number> {
    if (!Number.isSafeInteger(maxPages) || maxPages <= 0 || maxPages > 100) {
      throw new RangeError('Inventory convergence maxPages must be between 1 and 100.');
    }
    let applied = 0;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const cursor = await this.#database.transaction((transaction) =>
        transaction.inventory.getInventorySyncCursor(shopId),
      );
      const page = await this.#transport.pull(shopId, cursor);
      if (page.shopId !== shopId) throw new Error('Inventory convergence shop mismatch.');

      await this.#database.transaction(async (transaction) => {
        for (const item of page.items) {
          if (item.shopId !== shopId) throw new Error('Inventory convergence item shop mismatch.');
          await transaction.inventory.putItem(item);
        }
        for (const movement of page.movements) {
          if (movement.shopId !== shopId) {
            throw new Error('Inventory convergence movement shop mismatch.');
          }
          await transaction.inventory.upsertCanonicalMovement(movement);
        }
        for (const cost of page.costs) {
          await transaction.inventory.putWeightedUnitCost(
            shopId,
            cost.itemId,
            cost.weightedUnitCostMinor,
          );
        }
        if (page.nextCursor !== null) {
          await transaction.inventory.setInventorySyncCursor(shopId, page.nextCursor);
        }
      });
      applied += page.movements.length;
      if (!page.hasMore || page.nextCursor === null || page.nextCursor === cursor) break;
    }
    return applied;
  }
}

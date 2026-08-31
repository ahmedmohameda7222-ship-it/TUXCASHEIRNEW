import {
  instant,
  normalizeWorkerMenuLayoutUpdate,
  parseWorkerMenuLayout,
  reconcileWorkerMenuLayout,
  sameWorkerMenuLayoutSnapshot,
  type CategoryAlignment,
  type Instant,
  type MenuCategoryId,
  type ProductId,
  type ProductOrderByCategory,
  type ShopId,
  type WorkerId,
  type WorkerMenuLayout,
  type WorkerMenuLayoutCatalog,
  type WorkerMenuLayoutUpdate,
} from '@tux/domain';
import type { WorkerMenuLayoutRepository } from '@tux/persistence';

export interface RemoteWorkerMenuLayout {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrderByCategory: ProductOrderByCategory;
  readonly layoutVersion: number;
  readonly updatedAt: Instant;
}

export class WorkerMenuLayoutConflictError extends Error {
  constructor(message = 'Worker Menu Layout remote version conflict.') {
    super(message);
    this.name = 'WorkerMenuLayoutConflictError';
  }
}

export interface WorkerMenuLayoutRemoteGateway {
  getWorkerMenuLayout(shopId: ShopId, workerId: WorkerId): Promise<RemoteWorkerMenuLayout | null>;
  putWorkerMenuLayout(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrderByCategory: ProductOrderByCategory;
    readonly expectedLayoutVersion: number | null;
  }): Promise<RemoteWorkerMenuLayout>;
}

export interface WorkerMenuLayoutCatalogProvider {
  getWorkerMenuLayoutCatalog(shopId: ShopId): Promise<WorkerMenuLayoutCatalog>;
}

export interface WorkerMenuLayoutSyncIdentity {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
}

export interface WorkerMenuLayoutSyncTarget {
  syncOnce(shopId: ShopId, workerId: WorkerId): Promise<void>;
}

export interface WorkerMenuLayoutRetryOptions {
  readonly intervalMs?: number;
}

export type WorkerMenuLayoutListener = (layout: WorkerMenuLayout) => void;

const DEFAULT_WORKER_MENU_LAYOUT_RETRY_MS = 60_000;

function sameIdentity(left: WorkerMenuLayoutSyncIdentity, right: WorkerMenuLayoutSyncIdentity): boolean {
  return left.shopId === right.shopId && left.workerId === right.workerId;
}

export class WorkerMenuLayoutRetryController {
  readonly #target: WorkerMenuLayoutSyncTarget;
  readonly #identity: () => WorkerMenuLayoutSyncIdentity | null;
  readonly #intervalMs: number;
  #interval: ReturnType<typeof setInterval> | null = null;
  #syncInFlight: Promise<void> | null = null;

  constructor(
    target: WorkerMenuLayoutSyncTarget,
    identity: () => WorkerMenuLayoutSyncIdentity | null,
    options: WorkerMenuLayoutRetryOptions = {},
  ) {
    const intervalMs = options.intervalMs ?? DEFAULT_WORKER_MENU_LAYOUT_RETRY_MS;
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Worker Menu Layout retry interval must be a positive safe integer.');
    }
    this.#target = target;
    this.#identity = identity;
    this.#intervalMs = intervalMs;
  }

  start(): void {
    if (this.#interval !== null) return;
    this.#interval = setInterval(() => void this.syncActive(), this.#intervalMs);
  }

  stop(): void {
    if (this.#interval === null) return;
    clearInterval(this.#interval);
    this.#interval = null;
  }

  async syncActive(): Promise<void> {
    if (this.#syncInFlight !== null) return this.#syncInFlight;
    const identity = this.#identity();
    if (identity === null) return;

    const run = async (): Promise<void> => {
      let nextIdentity: WorkerMenuLayoutSyncIdentity | null = identity;
      while (nextIdentity !== null) {
        const currentIdentity = nextIdentity;
        await this.#target.syncOnce(currentIdentity.shopId, currentIdentity.workerId).catch(() => undefined);
        const activeIdentity = this.#identity();
        nextIdentity =
          activeIdentity !== null && !sameIdentity(activeIdentity, currentIdentity)
            ? activeIdentity
            : null;
      }
    };

    const sync = run().finally(() => {
      if (this.#syncInFlight === sync) this.#syncInFlight = null;
    });
    this.#syncInFlight = sync;
    return sync;
  }
}

function remoteAsClean(remote: RemoteWorkerMenuLayout): WorkerMenuLayout {
  return parseWorkerMenuLayout({ ...remote, syncState: 'CLEAN' });
}

function mutationKey(shopId: ShopId, workerId: WorkerId): string {
  return `${shopId}:${workerId}`;
}

export class WorkerMenuLayoutService implements WorkerMenuLayoutSyncTarget {
  readonly #repository: WorkerMenuLayoutRepository;
  readonly #gateway: WorkerMenuLayoutRemoteGateway;
  readonly #catalogProvider: WorkerMenuLayoutCatalogProvider;
  readonly #now: () => Instant;
  readonly #mutationTails = new Map<string, Promise<void>>();
  readonly #syncTails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<WorkerMenuLayoutListener>();

  constructor(
    repository: WorkerMenuLayoutRepository,
    gateway: WorkerMenuLayoutRemoteGateway,
    catalogProvider: WorkerMenuLayoutCatalogProvider,
    now: () => Instant = () => instant(new Date()),
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#catalogProvider = catalogProvider;
    this.#now = now;
  }

  subscribe(listener: WorkerMenuLayoutListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(layout: WorkerMenuLayout): void {
    for (const listener of this.#listeners) listener(layout);
  }

  async #serialize<T>(
    tails: Map<string, Promise<void>>,
    shopId: ShopId,
    workerId: WorkerId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = mutationKey(shopId, workerId);
    const previous = tails.get(key) ?? Promise.resolve();
    const ready = previous.catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = ready.then(() => gate);
    tails.set(key, tail);
    await ready;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  }

  #serializeLocalMutation<T>(
    shopId: ShopId,
    workerId: WorkerId,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.#serialize(this.#mutationTails, shopId, workerId, operation);
  }

  #serializeSync<T>(
    shopId: ShopId,
    workerId: WorkerId,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.#serialize(this.#syncTails, shopId, workerId, operation);
  }

  async load(shopId: ShopId, workerId: WorkerId): Promise<WorkerMenuLayout | null> {
    const local = await this.#repository.get(shopId, workerId);
    const catalog = await this.#catalogProvider.getWorkerMenuLayoutCatalog(shopId);
    if (local !== null) {
      const effective = reconcileWorkerMenuLayout(local, catalog);
      void this.syncOnce(shopId, workerId).catch(() => undefined);
      return effective;
    }

    try {
      const remote = await this.#gateway.getWorkerMenuLayout(shopId, workerId);
      if (remote === null) return null;
      const restored = remoteAsClean(remote);
      await this.#serializeLocalMutation(shopId, workerId, async () => {
        if ((await this.#repository.get(shopId, workerId)) !== null) return;
        await this.#repository.put(restored);
        this.#publish(restored);
      });
      return reconcileWorkerMenuLayout(restored, catalog);
    } catch {
      return null;
    }
  }

  async updateMenuLayout(
    shopId: ShopId,
    workerId: WorkerId,
    update: WorkerMenuLayoutUpdate,
  ): Promise<WorkerMenuLayout> {
    const next = await this.#serializeLocalMutation(shopId, workerId, async () => {
      const current = await this.#repository.get(shopId, workerId);
      const catalog = await this.#catalogProvider.getWorkerMenuLayoutCatalog(shopId);
      const normalized = normalizeWorkerMenuLayoutUpdate({
        shopId,
        workerId,
        update,
        catalog,
        layoutVersion: current?.layoutVersion ?? 0,
        updatedAt: this.#now(),
        syncState: 'DIRTY',
      });
      await this.#repository.put(normalized);
      this.#publish(normalized);
      return normalized;
    });
    void this.syncOnce(shopId, workerId).catch(() => undefined);
    return next;
  }

  async resetMenuLayout(shopId: ShopId, workerId: WorkerId): Promise<WorkerMenuLayout> {
    const next = await this.#serializeLocalMutation(shopId, workerId, async () => {
      const current = await this.#repository.get(shopId, workerId);
      const reset = parseWorkerMenuLayout({
        shopId,
        workerId,
        categoryOrder: [],
        categoryAlignment: 'left',
        productOrderByCategory: {},
        layoutVersion: current?.layoutVersion ?? 0,
        updatedAt: this.#now(),
        syncState: 'DIRTY',
      });
      await this.#repository.put(reset);
      this.#publish(reset);
      return reset;
    });
    void this.syncOnce(shopId, workerId).catch(() => undefined);
    return next;
  }

  async syncOnce(shopId: ShopId, workerId: WorkerId): Promise<void> {
    return this.#serializeSync(shopId, workerId, async () => {
      const local = await this.#repository.get(shopId, workerId);
      if (local?.syncState === 'DIRTY') {
        const remote = await this.#gateway.putWorkerMenuLayout({
          shopId,
          workerId,
          categoryOrder: local.categoryOrder,
          categoryAlignment: local.categoryAlignment,
          productOrderByCategory: local.productOrderByCategory,
          expectedLayoutVersion: local.layoutVersion === 0 ? null : local.layoutVersion,
        });
        const cleanRemote = remoteAsClean(remote);
        await this.#serializeLocalMutation(shopId, workerId, async () => {
          const current = await this.#repository.get(shopId, workerId);
          if (sameWorkerMenuLayoutSnapshot(current, local)) {
            await this.#repository.put(cleanRemote);
            this.#publish(cleanRemote);
            return;
          }
          if (
            current !== null &&
            current.syncState === 'DIRTY' &&
            current.layoutVersion === local.layoutVersion
          ) {
            const advancedDirty = parseWorkerMenuLayout({
              ...current,
              layoutVersion: cleanRemote.layoutVersion,
            });
            await this.#repository.put(advancedDirty);
            this.#publish(advancedDirty);
          }
        });
        return;
      }

      const remote = await this.#gateway.getWorkerMenuLayout(shopId, workerId);
      if (remote === null) return;
      const cleanRemote = remoteAsClean(remote);
      if (local !== null && cleanRemote.layoutVersion <= local.layoutVersion) return;

      await this.#serializeLocalMutation(shopId, workerId, async () => {
        const current = await this.#repository.get(shopId, workerId);
        if (!sameWorkerMenuLayoutSnapshot(current, local)) return;
        await this.#repository.put(cleanRemote);
        this.#publish(cleanRemote);
      });
    });
  }
}

export function workerMenuLayoutUpdateFromFlatProductOrder(input: {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
  readonly catalog: WorkerMenuLayoutCatalog;
}): WorkerMenuLayoutUpdate {
  const productsById = new Map(
    input.catalog.products.filter((product) => product.active).map((product) => [product.id, product]),
  );
  const productOrderByCategory: Partial<Record<MenuCategoryId, ProductId[]>> = {};
  for (const productId of input.productOrder) {
    const product = productsById.get(productId);
    if (product === undefined) continue;
    (productOrderByCategory[product.categoryId] ??= []).push(productId);
  }
  return {
    categoryOrder: input.categoryOrder,
    categoryAlignment: input.categoryAlignment,
    productOrderByCategory,
  };
}

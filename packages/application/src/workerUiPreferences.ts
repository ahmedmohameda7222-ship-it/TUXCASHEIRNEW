import {
  instant,
  parseWorkerUiPreferences,
  type CategoryAlignment,
  type Instant,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type SystemAccentColor,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';

export interface RemoteWorkerUiPreferences {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
  readonly accentColor: SystemAccentColor | null;
  readonly serverVersion: number;
  readonly updatedAt: Instant;
}

export interface WorkerUiPreferencesRemoteGateway {
  getWorkerUiPreferences(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerUiPreferences | null>;
  putWorkerUiPreferences(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
    readonly accentColor: SystemAccentColor | null;
  }): Promise<RemoteWorkerUiPreferences>;
}

export interface WorkerUiMenuLayoutUpdate {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}

export interface WorkerUiPreferencesSyncIdentity {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
}

export interface WorkerUiPreferencesSyncTarget {
  syncOnce(shopId: ShopId, workerId: WorkerId): Promise<void>;
}

export interface WorkerUiPreferencesRetryOptions {
  readonly intervalMs?: number;
}

const DEFAULT_WORKER_UI_PREFERENCES_RETRY_MS = 60_000;

export class WorkerUiPreferencesRetryController {
  readonly #target: WorkerUiPreferencesSyncTarget;
  readonly #identity: () => WorkerUiPreferencesSyncIdentity | null;
  readonly #intervalMs: number;
  #interval: ReturnType<typeof setInterval> | null = null;
  #syncInFlight: Promise<void> | null = null;

  constructor(
    target: WorkerUiPreferencesSyncTarget,
    identity: () => WorkerUiPreferencesSyncIdentity | null,
    options: WorkerUiPreferencesRetryOptions = {},
  ) {
    const intervalMs = options.intervalMs ?? DEFAULT_WORKER_UI_PREFERENCES_RETRY_MS;
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Worker UI preference retry interval must be a positive safe integer.');
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

    const sync = this.#target
      .syncOnce(identity.shopId, identity.workerId)
      .catch(() => undefined)
      .finally(() => {
        if (this.#syncInFlight === sync) this.#syncInFlight = null;
      });
    this.#syncInFlight = sync;
    return sync;
  }
}

export class WorkerUiPreferencesService implements WorkerUiPreferencesSyncTarget {
  readonly #repository: WorkerUiPreferencesRepository;
  readonly #gateway: WorkerUiPreferencesRemoteGateway;
  readonly #now: () => Instant;

  constructor(
    repository: WorkerUiPreferencesRepository,
    gateway: WorkerUiPreferencesRemoteGateway,
    now: () => Instant = () => instant(new Date()),
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#now = now;
  }

  async #currentOrDefault(shopId: ShopId, workerId: WorkerId): Promise<WorkerUiPreferences> {
    const current = await this.#repository.get(shopId, workerId);
    if (current !== null) return current;
    return parseWorkerUiPreferences({
      shopId,
      workerId,
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
      accentColor: null,
      updatedAt: this.#now(),
      serverVersion: 0,
      syncState: 'CLEAN',
    });
  }

  async updateMenuLayout(
    shopId: ShopId,
    workerId: WorkerId,
    input: WorkerUiMenuLayoutUpdate,
  ): Promise<WorkerUiPreferences> {
    const current = await this.#currentOrDefault(shopId, workerId);
    const next = parseWorkerUiPreferences({
      ...current,
      categoryOrder: input.categoryOrder,
      categoryAlignment: input.categoryAlignment,
      productOrder: input.productOrder,
      updatedAt: this.#now(),
      syncState: 'DIRTY',
    });
    await this.#repository.put(next);
    return next;
  }

  async updateAccentColor(
    shopId: ShopId,
    workerId: WorkerId,
    accentColor: SystemAccentColor | null,
  ): Promise<WorkerUiPreferences> {
    const current = await this.#currentOrDefault(shopId, workerId);
    const next = parseWorkerUiPreferences({
      ...current,
      accentColor,
      updatedAt: this.#now(),
      syncState: 'DIRTY',
    });
    await this.#repository.put(next);
    return next;
  }

  async syncOnce(shopId: ShopId, workerId: WorkerId): Promise<void> {
    const local = await this.#repository.get(shopId, workerId);
    if (local?.syncState === 'DIRTY') {
      const remote = await this.#gateway.putWorkerUiPreferences({
        shopId,
        workerId,
        categoryOrder: local.categoryOrder,
        categoryAlignment: local.categoryAlignment,
        productOrder: local.productOrder,
        accentColor: local.accentColor,
      });
      await this.#repository.put(
        parseWorkerUiPreferences({
          ...remote,
          syncState: 'CLEAN',
        }),
      );
      return;
    }

    const remote = await this.#gateway.getWorkerUiPreferences(shopId, workerId);
    if (remote !== null && (local === null || remote.serverVersion > local.serverVersion)) {
      await this.#repository.put(
        parseWorkerUiPreferences({
          ...remote,
          syncState: 'CLEAN',
        }),
      );
    }
  }
}

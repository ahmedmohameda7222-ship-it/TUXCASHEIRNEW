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

export type WorkerUiPreferencesListener = (preferences: WorkerUiPreferences) => void;

const DEFAULT_WORKER_UI_PREFERENCES_RETRY_MS = 60_000;

function sameIds<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSyncIdentity(
  left: WorkerUiPreferencesSyncIdentity,
  right: WorkerUiPreferencesSyncIdentity,
): boolean {
  return left.shopId === right.shopId && left.workerId === right.workerId;
}

function samePreferenceSnapshot(
  left: WorkerUiPreferences | null,
  right: WorkerUiPreferences | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.shopId === right.shopId &&
    left.workerId === right.workerId &&
    sameIds(left.categoryOrder, right.categoryOrder) &&
    left.categoryAlignment === right.categoryAlignment &&
    sameIds(left.productOrder, right.productOrder) &&
    left.accentColor === right.accentColor &&
    left.updatedAt === right.updatedAt &&
    left.serverVersion === right.serverVersion &&
    left.syncState === right.syncState
  );
}

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

    const run = async (): Promise<void> => {
      let nextIdentity: WorkerUiPreferencesSyncIdentity | null = identity;
      while (nextIdentity !== null) {
        const currentIdentity: WorkerUiPreferencesSyncIdentity = nextIdentity;
        await this.#target
          .syncOnce(currentIdentity.shopId, currentIdentity.workerId)
          .catch(() => undefined);
        const activeIdentity = this.#identity();
        nextIdentity =
          activeIdentity !== null && !sameSyncIdentity(activeIdentity, currentIdentity)
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

export class WorkerUiPreferencesService implements WorkerUiPreferencesSyncTarget {
  readonly #repository: WorkerUiPreferencesRepository;
  readonly #gateway: WorkerUiPreferencesRemoteGateway;
  readonly #now: () => Instant;
  readonly #mutationTails = new Map<string, Promise<void>>();
  readonly #listeners = new Set<WorkerUiPreferencesListener>();

  constructor(
    repository: WorkerUiPreferencesRepository,
    gateway: WorkerUiPreferencesRemoteGateway,
    now: () => Instant = () => instant(new Date()),
  ) {
    this.#repository = repository;
    this.#gateway = gateway;
    this.#now = now;
  }

  subscribe(listener: WorkerUiPreferencesListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(preferences: WorkerUiPreferences): void {
    for (const listener of this.#listeners) listener(preferences);
  }

  async #serializeLocalMutation<T>(
    shopId: ShopId,
    workerId: WorkerId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${shopId}:${workerId}`;
    const previous = this.#mutationTails.get(key) ?? Promise.resolve();
    const ready = previous.catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = ready.then(() => gate);
    this.#mutationTails.set(key, tail);

    await ready;
    try {
      return await operation();
    } finally {
      release();
      if (this.#mutationTails.get(key) === tail) this.#mutationTails.delete(key);
    }
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
    return this.#serializeLocalMutation(shopId, workerId, async () => {
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
      this.#publish(next);
      return next;
    });
  }

  async updateAccentColor(
    shopId: ShopId,
    workerId: WorkerId,
    accentColor: SystemAccentColor | null,
  ): Promise<WorkerUiPreferences> {
    return this.#serializeLocalMutation(shopId, workerId, async () => {
      const current = await this.#currentOrDefault(shopId, workerId);
      const next = parseWorkerUiPreferences({
        ...current,
        accentColor,
        updatedAt: this.#now(),
        syncState: 'DIRTY',
      });
      await this.#repository.put(next);
      this.#publish(next);
      return next;
    });
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
      await this.#serializeLocalMutation(shopId, workerId, async () => {
        const current = await this.#repository.get(shopId, workerId);
        if (!samePreferenceSnapshot(current, local)) return;
        const next = parseWorkerUiPreferences({
          ...remote,
          syncState: 'CLEAN',
        });
        await this.#repository.put(next);
        this.#publish(next);
      });
      return;
    }

    const remote = await this.#gateway.getWorkerUiPreferences(shopId, workerId);
    if (remote === null || (local !== null && remote.serverVersion <= local.serverVersion)) return;

    await this.#serializeLocalMutation(shopId, workerId, async () => {
      const current = await this.#repository.get(shopId, workerId);
      if (!samePreferenceSnapshot(current, local)) return;
      const next = parseWorkerUiPreferences({
        ...remote,
        syncState: 'CLEAN',
      });
      await this.#repository.put(next);
      this.#publish(next);
    });
  }
}

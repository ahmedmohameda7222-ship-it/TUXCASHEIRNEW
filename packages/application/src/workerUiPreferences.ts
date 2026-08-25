import {
  instant,
  parseWorkerUiPreferences,
  type CategoryAlignment,
  type Instant,
  type MenuCategoryId,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';

export interface RemoteWorkerUiPreferences {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
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
  }): Promise<RemoteWorkerUiPreferences>;
}

export interface WorkerUiPreferencesUpdate {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
}

export class WorkerUiPreferencesService {
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

  async update(
    shopId: ShopId,
    workerId: WorkerId,
    input: WorkerUiPreferencesUpdate,
  ): Promise<WorkerUiPreferences> {
    const current = await this.#repository.get(shopId, workerId);
    const next = parseWorkerUiPreferences({
      shopId,
      workerId,
      categoryOrder: input.categoryOrder,
      categoryAlignment: input.categoryAlignment,
      updatedAt: this.#now(),
      serverVersion: current?.serverVersion ?? 0,
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
      });
      await this.#repository.put(
        parseWorkerUiPreferences({
          ...local,
          serverVersion: remote.serverVersion,
          updatedAt: remote.updatedAt,
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

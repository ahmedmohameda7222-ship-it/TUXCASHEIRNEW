import {
  instant,
  parseEntityId,
  parseSystemAccentColor,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import { describe, expect, it } from 'vitest';
import {
  WorkerUiPreferencesService,
  type RemoteWorkerUiPreferences,
  type WorkerUiPreferencesRemoteGateway,
} from './workerUiPreferences';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const categoryA = parseEntityId<MenuCategoryId>(
  '33333333-3333-4333-8333-333333333331',
);
const categoryB = parseEntityId<MenuCategoryId>(
  '33333333-3333-4333-8333-333333333332',
);
const productA = parseEntityId<ProductId>('44444444-4444-4444-8444-444444444441');
const productB = parseEntityId<ProductId>('44444444-4444-4444-8444-444444444442');
const accentA = parseSystemAccentColor('#1E3A8A');
const accentB = parseSystemAccentColor('#7E22CE');

function preference(overrides: Partial<WorkerUiPreferences> = {}): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder: [categoryA],
    categoryAlignment: 'left',
    productOrder: [productA],
    accentColor: accentA,
    updatedAt: instant('2026-08-29T08:00:00.000Z'),
    serverVersion: 3,
    syncState: 'CLEAN',
    ...overrides,
  };
}

function remote(
  overrides: Partial<RemoteWorkerUiPreferences> = {},
): RemoteWorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder: [categoryA],
    categoryAlignment: 'left',
    productOrder: [productA],
    accentColor: accentA,
    updatedAt: instant('2026-08-29T08:00:01.000Z'),
    serverVersion: 4,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class MemoryRepository implements WorkerUiPreferencesRepository {
  value: WorkerUiPreferences | null;

  constructor(value: WorkerUiPreferences | null) {
    this.value = value;
  }

  async get(requestedShopId: ShopId, requestedWorkerId: WorkerId) {
    return this.value?.shopId === requestedShopId && this.value.workerId === requestedWorkerId
      ? this.value
      : null;
  }

  async put(value: WorkerUiPreferences) {
    this.value = value;
  }

  async delete(requestedShopId: ShopId, requestedWorkerId: WorkerId) {
    if (this.value?.shopId === requestedShopId && this.value.workerId === requestedWorkerId) {
      this.value = null;
    }
  }
}

class BarrierRepository extends MemoryRepository {
  readonly #barrier = deferred<void>();
  #reads = 0;

  override async get(requestedShopId: ShopId, requestedWorkerId: WorkerId) {
    const snapshot = await super.get(requestedShopId, requestedWorkerId);
    if (this.#reads < 2) {
      this.#reads += 1;
      if (this.#reads === 2) this.#barrier.resolve();
      await this.#barrier.promise;
    }
    return snapshot;
  }
}

class PausedGateway implements WorkerUiPreferencesRemoteGateway {
  readonly putStarted = deferred<void>();
  readonly getStarted = deferred<void>();
  readonly #putResult = deferred<RemoteWorkerUiPreferences>();
  readonly #getResult = deferred<RemoteWorkerUiPreferences | null>();

  async getWorkerUiPreferences() {
    this.getStarted.resolve();
    return this.#getResult.promise;
  }

  async putWorkerUiPreferences() {
    this.putStarted.resolve();
    return this.#putResult.promise;
  }

  resolvePut(value: RemoteWorkerUiPreferences): void {
    this.#putResult.resolve(value);
  }

  resolveGet(value: RemoteWorkerUiPreferences | null): void {
    this.#getResult.resolve(value);
  }
}

class NoopGateway implements WorkerUiPreferencesRemoteGateway {
  async getWorkerUiPreferences() {
    return null;
  }

  async putWorkerUiPreferences() {
    return remote();
  }
}

describe('WorkerUiPreferencesService concurrency safety', () => {
  it('serializes concurrent local menu-layout and accent mutations without losing either update', async () => {
    const repository = new BarrierRepository(preference());
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-29T08:01:00.000Z'),
    );

    await Promise.all([
      service.updateMenuLayout(shopId, workerId, {
        categoryOrder: [categoryB],
        categoryAlignment: 'right',
        productOrder: [productB],
      }),
      service.updateAccentColor(shopId, workerId, accentB),
    ]);

    expect(repository.value).toMatchObject({
      categoryOrder: [categoryB],
      categoryAlignment: 'right',
      productOrder: [productB],
      accentColor: accentB,
      syncState: 'DIRTY',
    });
  });

  it('preserves a newer DIRTY local mutation when an older DIRTY push response returns', async () => {
    const repository = new MemoryRepository(preference({ syncState: 'DIRTY' }));
    const gateway = new PausedGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-29T08:02:00.000Z'),
    );

    const sync = service.syncOnce(shopId, workerId);
    await gateway.putStarted.promise;
    await service.updateAccentColor(shopId, workerId, accentB);
    gateway.resolvePut(remote({ accentColor: accentA, serverVersion: 4 }));
    await sync;

    expect(repository.value).toMatchObject({
      accentColor: accentB,
      syncState: 'DIRTY',
      serverVersion: 3,
    });
  });

  it('preserves a newer DIRTY local mutation when an older remote pull returns', async () => {
    const repository = new MemoryRepository(
      preference({ accentColor: null, syncState: 'CLEAN', serverVersion: 3 }),
    );
    const gateway = new PausedGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-29T08:03:00.000Z'),
    );

    const sync = service.syncOnce(shopId, workerId);
    await gateway.getStarted.promise;
    await service.updateAccentColor(shopId, workerId, accentB);
    gateway.resolveGet(remote({ accentColor: accentA, serverVersion: 4 }));
    await sync;

    expect(repository.value).toMatchObject({
      accentColor: accentB,
      syncState: 'DIRTY',
      serverVersion: 3,
    });
  });
});

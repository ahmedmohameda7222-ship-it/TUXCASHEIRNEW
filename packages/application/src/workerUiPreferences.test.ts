import {
  instant,
  parseEntityId,
  parseSystemAccentColor,
  type CategoryAlignment,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type SystemAccentColor,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkerUiPreferencesRetryController,
  WorkerUiPreferencesService,
  type RemoteWorkerUiPreferences,
  type WorkerUiPreferencesRemoteGateway,
} from './workerUiPreferences';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const categoryA = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333331');
const categoryB = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333332');
const productA = parseEntityId<ProductId>('44444444-4444-4444-8444-444444444441');
const productB = parseEntityId<ProductId>('44444444-4444-4444-8444-444444444442');
const customAccent = parseSystemAccentColor('#1E3A8A');

function preference(overrides: Partial<WorkerUiPreferences> = {}): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder: [categoryA],
    categoryAlignment: 'center',
    productOrder: [],
    accentColor: null,
    updatedAt: instant('2026-08-25T03:00:00.000Z'),
    serverVersion: 3,
    syncState: 'CLEAN',
    ...overrides,
  };
}

function remote(overrides: Partial<RemoteWorkerUiPreferences> = {}): RemoteWorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder: [categoryA],
    categoryAlignment: 'center',
    productOrder: [],
    accentColor: null,
    updatedAt: instant('2026-08-25T03:05:00.000Z'),
    serverVersion: 4,
    ...overrides,
  };
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

class RecordingGateway implements WorkerUiPreferencesRemoteGateway {
  readonly calls: string[] = [];
  readonly putInputs: unknown[] = [];
  getResult: RemoteWorkerUiPreferences | null = null;
  putResult: RemoteWorkerUiPreferences = remote();
  putError: Error | null = null;

  async getWorkerUiPreferences() {
    this.calls.push('get');
    return this.getResult;
  }

  async putWorkerUiPreferences(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
    readonly accentColor: SystemAccentColor | null;
  }) {
    this.calls.push(`put:${input.categoryAlignment}:${input.categoryOrder.join(',')}`);
    this.putInputs.push(input);
    if (this.putError !== null) throw this.putError;
    return this.putResult;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkerUiPreferencesService', () => {
  it('updates menu layout locally first, marks it DIRTY, and preserves server version', async () => {
    const repository = new MemoryRepository(preference({ serverVersion: 7 }));
    const gateway = new RecordingGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-25T03:10:00.000Z'),
    );

    const result = await service.updateMenuLayout(shopId, workerId, {
      categoryOrder: [categoryB, categoryA],
      categoryAlignment: 'right',
      productOrder: [],
    });

    expect(result).toEqual(
      preference({
        categoryOrder: [categoryB, categoryA],
        categoryAlignment: 'right',
        updatedAt: instant('2026-08-25T03:10:00.000Z'),
        serverVersion: 7,
        syncState: 'DIRTY',
      }),
    );
    expect(repository.value).toEqual(result);
    expect(gateway.calls).toEqual([]);
  });

  it('changes accent without overwriting menu layout', async () => {
    const repository = new MemoryRepository(
      preference({
        categoryOrder: [categoryA, categoryB],
        categoryAlignment: 'right',
        productOrder: [productA],
        accentColor: null,
        serverVersion: 7,
      }),
    );
    const gateway = new RecordingGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-25T03:10:00.000Z'),
    );

    const saved = await service.updateAccentColor(shopId, workerId, customAccent);

    expect(saved).toMatchObject({
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'right',
      productOrder: [productA],
      accentColor: '#1E3A8A',
      serverVersion: 7,
      syncState: 'DIRTY',
      updatedAt: instant('2026-08-25T03:10:00.000Z'),
    });
  });

  it('changes menu layout without overwriting accent', async () => {
    const repository = new MemoryRepository(preference({ accentColor: customAccent }));
    const gateway = new RecordingGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-25T03:10:00.000Z'),
    );

    const saved = await service.updateMenuLayout(shopId, workerId, {
      categoryOrder: [categoryB],
      categoryAlignment: 'center',
      productOrder: [productB],
    });

    expect(saved.categoryOrder).toEqual([categoryB]);
    expect(saved.categoryAlignment).toBe('center');
    expect(saved.productOrder).toEqual([productB]);
    expect(saved.accentColor).toBe('#1E3A8A');
  });

  it('creates default menu layout on a first color-only update', async () => {
    const repository = new MemoryRepository(null);
    const gateway = new RecordingGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-25T03:10:00.000Z'),
    );

    const saved = await service.updateAccentColor(shopId, workerId, customAccent);

    expect(saved).toEqual({
      shopId,
      workerId,
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
      accentColor: '#1E3A8A',
      updatedAt: instant('2026-08-25T03:10:00.000Z'),
      serverVersion: 0,
      syncState: 'DIRTY',
    });
  });

  it('persists a non-empty product order in the local worker preference update', async () => {
    const repository = new MemoryRepository(preference({ serverVersion: 7 }));
    const gateway = new RecordingGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-25T03:10:00.000Z'),
    );
    const update = {
      categoryOrder: [categoryA],
      categoryAlignment: 'center' as const,
      productOrder: [productB, productA],
    };

    const result = await service.updateMenuLayout(shopId, workerId, update);

    expect(result.productOrder).toEqual([productB, productA]);
    expect(repository.value?.productOrder).toEqual([productB, productA]);
  });

  it('pushes DIRTY local state before any pull and accepts the authoritative remote version', async () => {
    const repository = new MemoryRepository(
      preference({ categoryOrder: [categoryB], categoryAlignment: 'left', syncState: 'DIRTY' }),
    );
    const gateway = new RecordingGateway();
    gateway.getResult = remote({ serverVersion: 99, categoryOrder: [categoryA] });
    gateway.putResult = remote({
      categoryOrder: [categoryB],
      categoryAlignment: 'left',
      accentColor: customAccent,
      serverVersion: 4,
    });
    const service = new WorkerUiPreferencesService(repository, gateway);

    await service.syncOnce(shopId, workerId);

    expect(gateway.calls).toEqual([`put:left:${categoryB}`]);
    expect(repository.value).toEqual(
      preference({
        categoryOrder: [categoryB],
        categoryAlignment: 'left',
        accentColor: customAccent,
        updatedAt: instant('2026-08-25T03:05:00.000Z'),
        serverVersion: 4,
        syncState: 'CLEAN',
      }),
    );
  });

  it('includes the complete preference when pushing DIRTY local state', async () => {
    const repository = new MemoryRepository(
      preference({
        productOrder: [productB, productA],
        accentColor: customAccent,
        syncState: 'DIRTY',
      }),
    );
    const gateway = new RecordingGateway();
    gateway.putResult = remote({ accentColor: customAccent, serverVersion: 4 });
    const service = new WorkerUiPreferencesService(repository, gateway);

    await service.syncOnce(shopId, workerId);

    expect(gateway.putInputs).toHaveLength(1);
    expect(gateway.putInputs[0]).toMatchObject({
      shopId,
      workerId,
      categoryOrder: [categoryA],
      categoryAlignment: 'center',
      productOrder: [productB, productA],
      accentColor: '#1E3A8A',
    });
  });

  it('pulls a newer remote preference into CLEAN local state', async () => {
    const repository = new MemoryRepository(preference({ serverVersion: 3 }));
    const gateway = new RecordingGateway();
    gateway.getResult = remote({
      categoryOrder: [categoryB],
      categoryAlignment: 'right',
      accentColor: customAccent,
      serverVersion: 4,
    });
    const service = new WorkerUiPreferencesService(repository, gateway);

    await service.syncOnce(shopId, workerId);

    expect(gateway.calls).toEqual(['get']);
    expect(repository.value).toEqual({
      ...gateway.getResult,
      syncState: 'CLEAN',
    });
  });

  it('does not replace local state when the remote version is not newer', async () => {
    const local = preference({ categoryOrder: [categoryB], accentColor: customAccent, serverVersion: 4 });
    const repository = new MemoryRepository(local);
    const gateway = new RecordingGateway();
    gateway.getResult = remote({ categoryOrder: [categoryA], serverVersion: 4 });
    const service = new WorkerUiPreferencesService(repository, gateway);

    await service.syncOnce(shopId, workerId);

    expect(repository.value).toEqual(local);
  });

  it('installs remote state when no local preference exists', async () => {
    const repository = new MemoryRepository(null);
    const gateway = new RecordingGateway();
    gateway.getResult = remote({ categoryAlignment: 'left', accentColor: customAccent });
    const service = new WorkerUiPreferencesService(repository, gateway);

    await service.syncOnce(shopId, workerId);

    expect(repository.value).toEqual({
      ...gateway.getResult,
      syncState: 'CLEAN',
    });
  });

  it('keeps DIRTY local data when the remote push fails', async () => {
    const local = preference({
      categoryOrder: [categoryB],
      accentColor: customAccent,
      syncState: 'DIRTY',
    });
    const repository = new MemoryRepository(local);
    const gateway = new RecordingGateway();
    gateway.putError = new Error('offline');
    const service = new WorkerUiPreferencesService(repository, gateway);

    await expect(service.syncOnce(shopId, workerId)).rejects.toThrow('offline');
    expect(repository.value).toEqual(local);
    expect(gateway.calls).toEqual([`put:center:${categoryB}`]);
  });
});

describe('WorkerUiPreferencesRetryController', () => {
  it('runs only for an active identity and retries on the configured interval', async () => {
    vi.useFakeTimers();
    const syncOnce = vi.fn().mockResolvedValue(undefined);
    let identity: { shopId: ShopId; workerId: WorkerId } | null = null;
    const controller = new WorkerUiPreferencesRetryController({ syncOnce }, () => identity, {
      intervalMs: 60_000,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncOnce).not.toHaveBeenCalled();

    identity = { shopId, workerId };
    await controller.syncActive();
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(syncOnce).toHaveBeenLastCalledWith(shopId, workerId);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it('swallows retry failures and prevents overlapping sync calls', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const syncOnce = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error('offline'));
    const controller = new WorkerUiPreferencesRetryController({ syncOnce }, () => ({
      shopId,
      workerId,
    }));

    const pending = controller.syncActive();
    const duplicate = controller.syncActive();
    expect(syncOnce).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.all([pending, duplicate]);

    await expect(controller.syncActive()).resolves.toBeUndefined();
    expect(syncOnce).toHaveBeenCalledTimes(2);
  });
});

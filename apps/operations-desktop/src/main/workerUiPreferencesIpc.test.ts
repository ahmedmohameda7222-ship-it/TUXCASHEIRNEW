import {
  WorkerUiPreferencesService,
  ok,
  type OperationsSessionResult,
  type RemoteWorkerUiPreferences,
  type WorkerUiPreferencesRemoteGateway,
} from '@tux/application';
import {
  instant,
  parseEntityId,
  parseSystemAccentColor,
  type BusinessDayId,
  type CategoryAlignment,
  type MenuCategoryId,
  type ShopId,
  type SystemAccentColor,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import { WorkerUiPreferencesIpcRuntime } from './workerUiPreferencesIpc';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerA = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222221');
const workerB = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const categoryA = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333331');
const categoryB = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333332');
const businessDayId = parseEntityId<BusinessDayId>('44444444-4444-4444-8444-444444444444');
const customAccent = parseSystemAccentColor('#1E3A8A');

function active(workerId: WorkerId, displayName: string): OperationsSessionResult {
  return ok({
    status: 'ACTIVE' as const,
    shopId,
    businessDayId,
    businessDayStartedAt: instant('2026-08-25T02:00:00.000Z'),
    operator: { id: workerId, displayName },
  });
}

function preference(
  workerId: WorkerId,
  categoryOrder: readonly MenuCategoryId[],
  categoryAlignment: CategoryAlignment,
  accentColor: SystemAccentColor | null = null,
): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment,
    productOrder: [],
    accentColor,
    updatedAt: instant('2026-08-25T03:00:00.000Z'),
    serverVersion: 2,
    syncState: 'CLEAN',
  };
}

class MemoryRepository implements WorkerUiPreferencesRepository {
  readonly values = new Map<string, WorkerUiPreferences>();

  async get(requestedShopId: ShopId, requestedWorkerId: WorkerId) {
    return this.values.get(`${requestedShopId}:${requestedWorkerId}`) ?? null;
  }

  async put(value: WorkerUiPreferences) {
    this.values.set(`${value.shopId}:${value.workerId}`, value);
  }

  async delete(requestedShopId: ShopId, requestedWorkerId: WorkerId) {
    this.values.delete(`${requestedShopId}:${requestedWorkerId}`);
  }
}

class NoopGateway implements WorkerUiPreferencesRemoteGateway {
  async getWorkerUiPreferences(): Promise<RemoteWorkerUiPreferences | null> {
    return null;
  }

  async putWorkerUiPreferences(): Promise<RemoteWorkerUiPreferences> {
    throw new Error('not used by local IPC update tests');
  }
}

describe('WorkerUiPreferencesIpcRuntime', () => {
  it('updates menu layout for only the active worker and preserves its accent', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryA], 'left'));
    await repository.put(preference(workerB, [categoryB], 'right', customAccent));
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-25T03:15:00.000Z'),
    );
    let session = active(workerA, 'Worker A');
    const changed = vi.fn();
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => session,
      repository,
      service,
      onChanged: changed,
    });

    await expect(runtime.load()).resolves.toMatchObject({
      workerId: workerA,
      categoryOrder: [categoryA],
      accentColor: null,
    });

    session = active(workerB, 'Worker B');
    const updated = await runtime.updateMenuLayout({
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      productOrder: [],
    });

    expect(updated).toMatchObject({
      workerId: workerB,
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      accentColor: customAccent,
      syncState: 'DIRTY',
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await repository.get(shopId, workerA)).toEqual(preference(workerA, [categoryA], 'left'));
  });

  it('updates accent for only the active worker and preserves its menu layout', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryB, categoryA], 'right'));
    await repository.put(preference(workerB, [categoryB], 'left'));
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-25T03:16:00.000Z'),
    );
    const changed = vi.fn();
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => active(workerA, 'Worker A'),
      repository,
      service,
      onChanged: changed,
    });

    const updated = await runtime.updateAccentColor(customAccent);
    expect(updated).toMatchObject({
      workerId: workerA,
      categoryOrder: [categoryB, categoryA],
      categoryAlignment: 'right',
      productOrder: [],
      accentColor: customAccent,
      syncState: 'DIRTY',
    });
    expect(await repository.get(shopId, workerB)).toEqual(preference(workerB, [categoryB], 'left'));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('exposes live preference subscription and stops after unsubscribe', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryA], 'left'));
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-25T03:16:30.000Z'),
    );
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => active(workerA, 'Worker A'),
      repository,
      service,
    });
    const listener = vi.fn();

    const unsubscribe = runtime.subscribe(listener);
    await runtime.updateAccentColor(customAccent);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workerId: workerA,
        accentColor: customAccent,
        syncState: 'DIRTY',
      }),
    );

    unsubscribe();
    await runtime.updateAccentColor(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or non-canonical accent input', async () => {
    const repository = new MemoryRepository();
    const service = new WorkerUiPreferencesService(repository, new NoopGateway());
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => active(workerA, 'Worker A'),
      repository,
      service,
    });

    await expect(runtime.updateAccentColor('#12345')).rejects.toThrow(TypeError);
    await expect(runtime.updateAccentColor('#1e3a8a')).rejects.toThrow(TypeError);
    expect(repository.values.size).toBe(0);
  });

  it('resets only the active worker menu layout and preserves accent', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryB, categoryA], 'right', customAccent));
    await repository.put(preference(workerB, [categoryB], 'left'));
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-25T03:17:00.000Z'),
    );
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => active(workerA, 'Worker A'),
      repository,
      service,
    });

    await expect(runtime.resetMenuLayout()).resolves.toBeUndefined();
    expect(await repository.get(shopId, workerA)).toMatchObject({
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
      accentColor: customAccent,
      syncState: 'DIRTY',
    });
    expect(await repository.get(shopId, workerB)).toEqual(preference(workerB, [categoryB], 'left'));
  });

  it('rejects every preference action when there is no active worker session', async () => {
    const repository = new MemoryRepository();
    const service = new WorkerUiPreferencesService(repository, new NoopGateway());
    const signedOut: OperationsSessionResult = ok({
      status: 'NO_ACTIVE_DAY',
      shopId,
    });
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => signedOut,
      repository,
      service,
    });

    await expect(runtime.load()).rejects.toThrow('Active worker session required.');
    await expect(
      runtime.updateMenuLayout({
        categoryOrder: [categoryA],
        categoryAlignment: 'left',
        productOrder: [],
      }),
    ).rejects.toThrow('Active worker session required.');
    await expect(runtime.updateAccentColor(customAccent)).rejects.toThrow(
      'Active worker session required.',
    );
    await expect(runtime.resetMenuLayout()).rejects.toThrow('Active worker session required.');
    expect(repository.values.size).toBe(0);
  });
});

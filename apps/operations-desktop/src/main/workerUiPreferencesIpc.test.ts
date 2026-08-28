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
  type BusinessDayId,
  type CategoryAlignment,
  type MenuCategoryId,
  type ShopId,
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
): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment,
    productOrder: [],
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
  it('loads and updates only the currently active worker preference', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryA], 'left'));
    await repository.put(preference(workerB, [categoryB], 'right'));
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
      categoryAlignment: 'left',
    });

    session = active(workerB, 'Worker B');
    await expect(runtime.load()).resolves.toMatchObject({
      workerId: workerB,
      categoryOrder: [categoryB],
      categoryAlignment: 'right',
    });

    const updated = await runtime.update({
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      productOrder: [],
    });
    expect(updated.workerId).toBe(workerB);
    expect(updated.syncState).toBe('DIRTY');
    expect(changed).toHaveBeenCalledTimes(1);

    expect(await repository.get(shopId, workerA)).toEqual(preference(workerA, [categoryA], 'left'));
    expect(await repository.get(shopId, workerB)).toMatchObject({
      workerId: workerB,
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      productOrder: [],
      syncState: 'DIRTY',
    });
  });

  it('resets only the active worker to config-order/default-alignment semantics', async () => {
    const repository = new MemoryRepository();
    await repository.put(preference(workerA, [categoryB, categoryA], 'right'));
    await repository.put(preference(workerB, [categoryB], 'left'));
    const service = new WorkerUiPreferencesService(repository, new NoopGateway(), () =>
      instant('2026-08-25T03:16:00.000Z'),
    );
    const runtime = new WorkerUiPreferencesIpcRuntime({
      getSessionState: async () => active(workerA, 'Worker A'),
      repository,
      service,
    });

    await expect(runtime.reset()).resolves.toBeUndefined();
    expect(await repository.get(shopId, workerA)).toMatchObject({
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
      syncState: 'DIRTY',
    });
    expect(await repository.get(shopId, workerB)).toEqual(preference(workerB, [categoryB], 'left'));
  });

  it('rejects access when there is no active worker session', async () => {
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
      runtime.update({
        categoryOrder: [categoryA],
        categoryAlignment: 'left',
        productOrder: [],
      }),
    ).rejects.toThrow('Active worker session required.');
    await expect(runtime.reset()).rejects.toThrow('Active worker session required.');
    expect(repository.values.size).toBe(0);
  });
});

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
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
import { expect, it, vi } from 'vitest';
import { WorkerUiPreferencesIpcRuntime } from './workerUiPreferencesIpc';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222221');
const businessDayId = parseEntityId<BusinessDayId>('44444444-4444-4444-8444-444444444444');
const remoteBlue = parseSystemAccentColor('#1E3A8A');

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

class DelayedRemoteGateway implements WorkerUiPreferencesRemoteGateway {
  #release!: (value: RemoteWorkerUiPreferences) => void;
  #requested!: () => void;
  readonly requested = new Promise<void>((resolve) => {
    this.#requested = resolve;
  });
  readonly #response = new Promise<RemoteWorkerUiPreferences>((resolve) => {
    this.#release = resolve;
  });

  async getWorkerUiPreferences(): Promise<RemoteWorkerUiPreferences> {
    this.#requested();
    return this.#response;
  }

  async putWorkerUiPreferences(): Promise<RemoteWorkerUiPreferences> {
    throw new Error('not used by clean remote reconciliation');
  }

  release(value: RemoteWorkerUiPreferences): void {
    this.#release(value);
  }
}

function activeSession(): OperationsSessionResult {
  return ok({
    status: 'ACTIVE' as const,
    shopId,
    businessDayId,
    businessDayStartedAt: instant('2026-08-29T14:00:00.000Z'),
    operator: { id: workerId, displayName: 'Worker A' },
  });
}

it('publishes newer delayed remote reconciliation through the Electron IPC runtime subscription', async () => {
  const repository = new MemoryRepository();
  await repository.put({
    shopId,
    workerId,
    categoryOrder: [],
    categoryAlignment: 'left',
    productOrder: [],
    accentColor: null,
    updatedAt: instant('2026-08-29T14:05:00.000Z'),
    serverVersion: 3,
    syncState: 'CLEAN',
  });
  const gateway = new DelayedRemoteGateway();
  const service = new WorkerUiPreferencesService(repository, gateway, () =>
    instant('2026-08-29T14:10:00.000Z'),
  );
  const runtime = new WorkerUiPreferencesIpcRuntime({
    getSessionState: async () => activeSession(),
    repository,
    service,
  });
  const listener = vi.fn();
  const unsubscribe = runtime.subscribe(listener);

  const sync = service.syncOnce(shopId, workerId);
  await gateway.requested;
  expect(listener).not.toHaveBeenCalled();

  gateway.release({
    shopId,
    workerId,
    categoryOrder: [],
    categoryAlignment: 'left',
    productOrder: [],
    accentColor: remoteBlue,
    updatedAt: instant('2026-08-29T14:15:00.000Z'),
    serverVersion: 4,
  });
  await sync;

  const reconciled = await repository.get(shopId, workerId);
  expect(reconciled).toMatchObject({
    workerId,
    accentColor: remoteBlue,
    serverVersion: 4,
    syncState: 'CLEAN',
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenLastCalledWith(
    expect.objectContaining({
      workerId,
      accentColor: remoteBlue,
      serverVersion: 4,
      syncState: 'CLEAN',
    }),
  );

  unsubscribe();
});

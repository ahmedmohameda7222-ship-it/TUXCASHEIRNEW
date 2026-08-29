import {
  instant,
  parseEntityId,
  parseSystemAccentColor,
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
const blue = parseSystemAccentColor('#1E3A8A');

class MemoryRepository implements WorkerUiPreferencesRepository {
  value: WorkerUiPreferences | null = null;

  async get() {
    return this.value;
  }

  async put(value: WorkerUiPreferences) {
    this.value = value;
  }

  async delete() {
    this.value = null;
  }
}

class RemoteGateway implements WorkerUiPreferencesRemoteGateway {
  remote: RemoteWorkerUiPreferences | null = null;

  async getWorkerUiPreferences() {
    return this.remote;
  }

  async putWorkerUiPreferences() {
    if (this.remote === null) throw new Error('Remote preference required.');
    return this.remote;
  }
}

describe('WorkerUiPreferencesService observable changes', () => {
  it('emits successful local mutations and remote reconciliation, then stops after unsubscribe', async () => {
    const repository = new MemoryRepository();
    const gateway = new RemoteGateway();
    const service = new WorkerUiPreferencesService(repository, gateway, () =>
      instant('2026-08-29T08:10:00.000Z'),
    );
    const observed: WorkerUiPreferences[] = [];
    const unsubscribe = service.subscribe((preferences) => observed.push(preferences));

    await service.updateAccentColor(shopId, workerId, blue);
    expect(observed.at(-1)?.accentColor).toBe(blue);
    expect(observed.at(-1)?.syncState).toBe('DIRTY');

    repository.value = {
      ...repository.value!,
      syncState: 'CLEAN',
      serverVersion: 1,
    };
    gateway.remote = {
      shopId,
      workerId,
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [],
      accentColor: blue,
      updatedAt: instant('2026-08-29T08:11:00.000Z'),
      serverVersion: 2,
    };
    await service.syncOnce(shopId, workerId);
    expect(observed.at(-1)?.serverVersion).toBe(2);
    expect(observed.at(-1)?.syncState).toBe('CLEAN');

    const countBeforeUnsubscribe = observed.length;
    unsubscribe();
    await service.updateAccentColor(shopId, workerId, null);
    expect(observed).toHaveLength(countBeforeUnsubscribe);
  });
});

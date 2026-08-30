import { parseEntityId, type ShopId, type WorkerId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { WorkerUiPreferencesRetryController } from './workerUiPreferences';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerA = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222221');
const workerB = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');

describe('WorkerUiPreferencesRetryController active identity handoff', () => {
  it('queues the newest worker identity while a previous worker sync is in flight', async () => {
    let releaseWorkerA!: () => void;
    const workerASync = new Promise<void>((resolve) => {
      releaseWorkerA = resolve;
    });
    const syncOnce = vi
      .fn()
      .mockImplementationOnce(() => workerASync)
      .mockResolvedValueOnce(undefined);
    let identity = { shopId, workerId: workerA };
    const controller = new WorkerUiPreferencesRetryController({ syncOnce }, () => identity);

    const first = controller.syncActive();
    identity = { shopId, workerId: workerB };
    const handoff = controller.syncActive();

    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(syncOnce).toHaveBeenNthCalledWith(1, shopId, workerA);

    releaseWorkerA();
    await Promise.all([first, handoff]);

    expect(syncOnce).toHaveBeenCalledTimes(2);
    expect(syncOnce).toHaveBeenNthCalledWith(2, shopId, workerB);
  });
});

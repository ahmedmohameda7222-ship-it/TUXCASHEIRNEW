import { describe, expect, it, vi } from 'vitest';

import { runCatalogScheduler, type CatalogSchedulerStore } from './scheduler';

function createStore(): CatalogSchedulerStore {
  let claimed = false;
  let applied = false;
  return {
    claimDue: vi.fn(async () => {
      if (claimed || applied) return [];
      claimed = true;
      return [
        {
          id: 'schedule-1',
          businessId: 'business-1',
          shopId: 'shop-a',
          changeKind: 'CATALOG_PUBLISH',
          payload: { draftId: 'draft-1', expectedDraftRevision: 3 },
          scheduledFor: '2026-09-11T05:00:00.000Z',
          targetBasePublishVersion: 48,
          idempotencyKey: 'publish:draft-1:48',
          attemptCount: 0,
        },
      ];
    }),
    markApplied: vi.fn(async () => {
      applied = true;
    }),
    markFailed: vi.fn(async () => {
      claimed = false;
    }),
  };
}

describe('catalog scheduler', () => {
  it('activates a due Cairo schedule exactly once across repeated runs', async () => {
    const store = createStore();
    const publish = vi.fn().mockResolvedValue({ ok: true, publishVersion: 49 });

    const deps = {
      store,
      publish,
      setAvailability: vi.fn(),
      now: () => new Date('2026-09-11T05:00:00.000Z'),
    };

    await runCatalogScheduler(deps);
    await runCatalogScheduler(deps);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(store.markApplied).toHaveBeenCalledTimes(1);
    expect(store.markFailed).not.toHaveBeenCalled();
  });
});

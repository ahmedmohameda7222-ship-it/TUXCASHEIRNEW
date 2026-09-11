import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { createCatalogService, type CatalogStore } from './catalogService';

const owner: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish'],
  shopIds: ['shop-a'],
};

type PublishControlStore = CatalogStore & {
  loadPublishing(shopId: string, businessId: string): Promise<unknown>;
  restoreVersion(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  scheduleDraft(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  cancelSchedule(input: Readonly<Record<string, unknown>>): Promise<unknown>;
};

type PublishControlService = ReturnType<typeof createCatalogService> & {
  loadCatalogPublishing(shopId: string, principal: AdminSessionPrincipal): Promise<unknown>;
  restoreCatalogVersion(
    input: Readonly<Record<string, unknown>>,
    principal: AdminSessionPrincipal,
  ): Promise<unknown>;
  scheduleCatalogDraft(
    input: Readonly<Record<string, unknown>>,
    principal: AdminSessionPrincipal,
  ): Promise<unknown>;
  cancelScheduledCatalogChange(
    input: Readonly<Record<string, unknown>>,
    principal: AdminSessionPrincipal,
  ): Promise<unknown>;
};

function store(overrides: Partial<PublishControlStore> = {}): PublishControlStore {
  return {
    getCurrentPublishVersion: vi.fn().mockResolvedValue(48),
    loadWorkspace: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      currentPublishVersion: 48,
      categories: [],
      products: [],
      drafts: [],
    }),
    createDraft: vi.fn().mockResolvedValue({
      ok: true,
      draftId: 'draft-new',
      draftRevision: 1,
      basePublishVersion: 48,
      bundleJson: { snapshot: { products: [] } },
    }),
    saveDraftChange: vi.fn().mockResolvedValue({
      ok: true,
      draftId: 'draft-1',
      draftRevision: 2,
      basePublishVersion: 48,
    }),
    publishDraft: vi.fn().mockResolvedValue({
      ok: true,
      draftId: 'draft-1',
      publishVersion: 49,
      operationsConfigurationVersion: 49,
    }),
    setImmediateAvailability: vi.fn().mockResolvedValue({
      ok: true,
      productId: 'product-1',
      soldOut: true,
      publishVersion: 49,
      operationsConfigurationVersion: 49,
    }),
    loadPublishing: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      currentPublishVersion: 48,
      versions: [],
      schedules: [],
    }),
    restoreVersion: vi.fn().mockResolvedValue({
      ok: true,
      sourcePublishVersion: 47,
      publishVersion: 49,
      operationsConfigurationVersion: 49,
    }),
    scheduleDraft: vi.fn().mockResolvedValue({
      ok: true,
      scheduleId: 'schedule-1',
      status: 'PENDING',
      localScheduledAt: '2099-09-11T08:00:00',
      scheduledFor: '2099-09-11T05:00:00.000Z',
      timezone: 'Africa/Cairo',
      idempotentReplay: false,
    }),
    cancelSchedule: vi.fn().mockResolvedValue({
      ok: true,
      scheduleId: 'schedule-1',
      status: 'CANCELLED',
      idempotentReplay: false,
    }),
    ...overrides,
  } as PublishControlStore;
}

function publishingService(catalogStore: PublishControlStore): PublishControlService {
  return createCatalogService(catalogStore) as PublishControlService;
}

describe('Admin catalog service', () => {
  it('loads a shop workspace only with catalog.view and explicit shop scope', async () => {
    const catalogStore = store();
    const service = createCatalogService(catalogStore);

    await expect(service.loadCatalogWorkspace('shop-a', owner)).resolves.toMatchObject({
      shopId: 'shop-a',
      currentPublishVersion: 48,
    });
    expect(catalogStore.loadWorkspace).toHaveBeenCalledWith('shop-a', 'business-1');

    await expect(service.loadCatalogWorkspace('shop-b', owner)).rejects.toThrow(/shop_forbidden/);
  });

  it('creates a draft from the authenticated employee at the expected live version', async () => {
    const catalogStore = store();
    const service = createCatalogService(catalogStore);

    await expect(
      service.createCatalogDraft(
        { shopId: 'shop-a', expectedVersion: 48, title: 'Edit Fixture Burger' },
        owner,
      ),
    ).resolves.toMatchObject({
      ok: true,
      draftId: 'draft-new',
      draftRevision: 1,
      basePublishVersion: 48,
    });

    expect(catalogStore.createDraft).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-a',
      expectedVersion: 48,
      title: 'Edit Fixture Burger',
    });
  });

  it('returns stale_version without calling publish when the base version changed', async () => {
    const catalogStore = store({
      getCurrentPublishVersion: vi.fn().mockResolvedValue(49),
      publishDraft: vi.fn(),
    });
    const service = createCatalogService(catalogStore);

    const result = await service.publishCatalogDraft(
      {
        draftId: 'draft-1',
        shopId: 'shop-a',
        expectedDraftRevision: 2,
        expectedVersion: 48,
      },
      owner,
    );

    expect(result).toEqual({
      ok: false,
      code: 'stale_version',
      message: expect.any(String),
      currentVersion: 49,
    });
    expect(catalogStore.publishDraft).not.toHaveBeenCalled();
  });

  it('requires catalog.pricing when a saved bundle changes price fields', async () => {
    const catalogStore = store();
    const service = createCatalogService(catalogStore);
    const editorOnly: AdminSessionPrincipal = {
      ...owner,
      permissions: ['catalog.edit'],
    };

    await expect(
      service.saveCatalogDraftChange(
        {
          draftId: 'draft-1',
          shopId: 'shop-a',
          expectedDraftRevision: 1,
          changes: [
            {
              kind: 'bundle.replace',
              bundleJson: {
                snapshot: {
                  products: [{ id: 'product-1', priceMinor: 1500 }],
                },
              },
            },
          ],
        },
        editorOnly,
      ),
    ).rejects.toThrow(/permission_forbidden/);
    expect(catalogStore.saveDraftChange).not.toHaveBeenCalled();
  });

  it('rejects immediate availability outside the principal shop scope before the RPC', async () => {
    const catalogStore = store();
    const service = createCatalogService(catalogStore);

    await expect(
      service.setImmediateAvailability(
        { shopId: 'shop-b', productId: 'product-1', soldOut: true },
        owner,
      ),
    ).rejects.toThrow(/shop_forbidden/);
    expect(catalogStore.setImmediateAvailability).not.toHaveBeenCalled();
  });

  it('passes the authenticated employee identity to the trusted publish RPC', async () => {
    const catalogStore = store();
    const service = createCatalogService(catalogStore);

    await expect(
      service.publishCatalogDraft(
        {
          draftId: 'draft-1',
          shopId: 'shop-a',
          expectedDraftRevision: 2,
          expectedVersion: 48,
        },
        owner,
      ),
    ).resolves.toMatchObject({ ok: true, publishVersion: 49 });

    expect(catalogStore.publishDraft).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      draftId: 'draft-1',
      expectedDraftRevision: 2,
      expectedVersion: 48,
    });
  });

  it('loads publish history only with catalog.view and explicit shop scope', async () => {
    const catalogStore = store();
    const service = publishingService(catalogStore);

    await expect(service.loadCatalogPublishing('shop-a', owner)).resolves.toMatchObject({
      shopId: 'shop-a',
      currentPublishVersion: 48,
    });
    expect(catalogStore.loadPublishing).toHaveBeenCalledWith('shop-a', 'business-1');

    await expect(service.loadCatalogPublishing('shop-b', owner)).rejects.toThrow(/shop_forbidden/);
  });

  it('fences a stale restore before calling the trusted restore RPC', async () => {
    const catalogStore = store({
      getCurrentPublishVersion: vi.fn().mockResolvedValue(49),
      restoreVersion: vi.fn(),
    });
    const service = publishingService(catalogStore);

    await expect(
      service.restoreCatalogVersion(
        { shopId: 'shop-a', sourcePublishVersion: 47, expectedVersion: 48 },
        owner,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'stale_version', currentVersion: 49 });
    expect(catalogStore.restoreVersion).not.toHaveBeenCalled();
  });

  it('schedules a draft with the authenticated employee and Cairo-local intent', async () => {
    const catalogStore = store();
    const service = publishingService(catalogStore);

    await expect(
      service.scheduleCatalogDraft(
        {
          draftId: 'draft-1',
          shopId: 'shop-a',
          expectedDraftRevision: 2,
          expectedVersion: 48,
          localScheduledAt: '2099-09-11T08:00:00',
        },
        owner,
      ),
    ).resolves.toMatchObject({ ok: true, scheduleId: 'schedule-1', status: 'PENDING' });

    expect(catalogStore.scheduleDraft).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      draftId: 'draft-1',
      expectedDraftRevision: 2,
      expectedVersion: 48,
      localScheduledAt: '2099-09-11T08:00:00',
    });
  });

  it('requires catalog.publish and concrete shop scope before cancelling a schedule', async () => {
    const catalogStore = store();
    const service = publishingService(catalogStore);
    const editorOnly: AdminSessionPrincipal = { ...owner, permissions: ['catalog.edit'] };

    await expect(
      service.cancelScheduledCatalogChange(
        { shopId: 'shop-a', scheduleId: 'schedule-1' },
        editorOnly,
      ),
    ).rejects.toThrow(/permission_forbidden/);
    await expect(
      service.cancelScheduledCatalogChange(
        { shopId: 'shop-b', scheduleId: 'schedule-1' },
        owner,
      ),
    ).rejects.toThrow(/shop_forbidden/);
    expect(catalogStore.cancelSchedule).not.toHaveBeenCalled();
  });
});

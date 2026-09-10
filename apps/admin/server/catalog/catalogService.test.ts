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

function store(overrides: Partial<CatalogStore> = {}): CatalogStore {
  return {
    getCurrentPublishVersion: vi.fn().mockResolvedValue(48),
    loadWorkspace: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      currentPublishVersion: 48,
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
    ...overrides,
  };
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
});

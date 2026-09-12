import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicCatalog } from './catalog-public';

const shopId = '11111111-1111-4111-8111-111111111111';
const revision = 'a'.repeat(64);

const v1Snapshot = {
  schemaVersion: 1,
  shopId,
  revision,
  categories: [],
  products: [],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('fetchPublicCatalog rollout compatibility', () => {
  it('falls back to V1 browsing when published V2 ordering projection is not available yet', async () => {
    vi.stubEnv('VITE_CATALOG_PUBLIC_URL', 'https://catalog.example/functions/v1/catalog-public');
    vi.stubEnv('VITE_TUX_SHOP_ID', shopId);

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ schemaVersion: 1, error: { code: 'catalog_unavailable' } }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(v1Snapshot), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await expect(fetchPublicCatalog()).resolves.toEqual(v1Snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('schemaVersion=2');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('schemaVersion=1');
  });

  it('does not downgrade arbitrary V2 failures to a V1 catalog', async () => {
    vi.stubEnv('VITE_CATALOG_PUBLIC_URL', 'https://catalog.example/functions/v1/catalog-public');
    vi.stubEnv('VITE_TUX_SHOP_ID', shopId);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: 1, error: { code: 'shop_not_found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(fetchPublicCatalog()).rejects.toThrow('catalog_public_unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

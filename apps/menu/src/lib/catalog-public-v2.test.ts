import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicCatalogSnapshotV2 } from '@tux/catalog-contracts';
import { fetchPublicCatalog } from './catalog-public';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

const snapshot: PublicCatalogSnapshotV2 = {
  schemaVersion: 2,
  shopId: SHOP_ID,
  revision: 'a'.repeat(64),
  categories: [],
  products: [],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  shop: {
    displayName: 'TUX Maadi',
    address: 'Road 9, Maadi',
    phone: '+201000000000',
    latitude: 29.9602,
    longitude: 31.2569,
  },
  ordering: {
    available: true,
    temporaryClosed: false,
    onlineOrdersPaused: false,
    minimumOrderMinor: 4500,
    fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
    paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Menu public catalog V2 client', () => {
  it('opts into V2 and returns the validated published shop and ordering projection', async () => {
    vi.stubEnv('VITE_CATALOG_PUBLIC_URL', 'https://menu-api.example.test/catalog-public');
    vi.stubEnv('VITE_TUX_SHOP_ID', SHOP_ID);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(fetchPublicCatalog()).resolves.toEqual(snapshot);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    expect(requestUrl.searchParams.get('shopId')).toBe(SHOP_ID);
    expect(requestUrl.searchParams.get('schemaVersion')).toBe('2');
  });
});

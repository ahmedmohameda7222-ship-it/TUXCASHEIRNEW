import { describe, expect, it } from 'vitest';

import {
  handleCatalogPublicRequest,
  type PublicCatalogStore,
} from './catalog';
import type { PublishedPublicOrderingProjection } from './published-ordering';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function projection(minimumOrderMinor = 3000): PublishedPublicOrderingProjection {
  return {
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
      minimumOrderMinor,
      fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
      paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
    },
  };
}

type V2Store = PublicCatalogStore & {
  readonly getPublishedOrderingProjection: (
    shopId: string,
  ) => Promise<PublishedPublicOrderingProjection | null>;
};

function store(publicProjection: PublishedPublicOrderingProjection | null): V2Store {
  return {
    getShop: async (shopId) => ({ id: shopId, active: true }),
    listCategories: async () => [],
    listProducts: async () => [],
    listModifiers: async () => [],
    listProductModifierLinks: async () => [],
    listComboBeverageOptions: async () => [],
    resolveImageUrl: () => null,
    getPublishedOrderingProjection: async (shopId) =>
      shopId === SHOP_ID ? publicProjection : null,
  };
}

function request(schemaVersion?: number): Request {
  const url = new URL('https://menu.example.test/catalog-public');
  url.searchParams.set('shopId', SHOP_ID);
  if (schemaVersion !== undefined) url.searchParams.set('schemaVersion', String(schemaVersion));
  return new Request(url, { method: 'GET' });
}

describe('catalog-public V2 HTTP contract', () => {
  it('returns the customer-safe published ordering projection when V2 is requested', async () => {
    const response = await handleCatalogPublicRequest(request(2), store(projection()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: 2,
      shopId: SHOP_ID,
      shop: projection().shop,
      ordering: projection().ordering,
    });
    expect(JSON.stringify(body)).not.toContain('integrationReference');
    expect(response.headers.get('etag')).toBe(`\"${body.revision}\"`);
  });

  it('keeps the existing V1 response as the default for deployed clients', async () => {
    const response = await handleCatalogPublicRequest(request(), store(projection()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schemaVersion).toBe(1);
    expect(body).not.toHaveProperty('shop');
    expect(body).not.toHaveProperty('ordering');
  });

  it('changes the V2 revision and ETag when only published ordering policy changes', async () => {
    const first = await handleCatalogPublicRequest(request(2), store(projection(3000)));
    const second = await handleCatalogPublicRequest(request(2), store(projection(4500)));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.revision).not.toBe(secondBody.revision);
    expect(first.headers.get('etag')).not.toBe(second.headers.get('etag'));
  });

  it('fails closed when V2 has no immutable published ordering projection', async () => {
    const response = await handleCatalogPublicRequest(request(2), store(null));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      error: { code: 'catalog_unavailable' },
    });
  });
});

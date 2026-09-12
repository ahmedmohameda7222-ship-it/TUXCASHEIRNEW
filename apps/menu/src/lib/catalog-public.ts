import {
  parsePublicCatalogSnapshotV1,
  parsePublicCatalogSnapshotV2,
  type PublicCatalogSnapshotV1,
  type PublicCatalogSnapshotV2,
} from '@tux/catalog-contracts';

export type MenuPublicCatalogSnapshot = PublicCatalogSnapshotV1 | PublicCatalogSnapshotV2;

const catalogPublicUrl = (): string => {
  const explicit = import.meta.env.VITE_CATALOG_PUBLIC_URL?.trim();
  if (explicit) return explicit;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('catalog_public_not_configured');
  }
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/catalog-public`;
};

const configuredShopId = (): string => {
  const shopId = import.meta.env.VITE_TUX_SHOP_ID?.trim();
  if (!shopId) throw new Error('catalog_shop_not_configured');
  return shopId;
};

function catalogUrl(shopId: string, schemaVersion: '1' | '2'): URL {
  const url = new URL(catalogPublicUrl());
  url.searchParams.set('shopId', shopId);
  url.searchParams.set('schemaVersion', schemaVersion);
  return url;
}

async function requestCatalog(
  shopId: string,
  schemaVersion: '1' | '2',
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(catalogUrl(shopId, schemaVersion), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
}

function assertShop(snapshotShopId: string, configuredId: string): void {
  if (snapshotShopId !== configuredId.toLowerCase()) {
    throw new Error('catalog_shop_mismatch');
  }
}

export async function fetchPublicCatalog(signal?: AbortSignal): Promise<MenuPublicCatalogSnapshot> {
  const shopId = configuredShopId();
  const v2Response = await requestCatalog(shopId, '2', signal);

  if (v2Response.ok) {
    const snapshot = parsePublicCatalogSnapshotV2(await v2Response.json());
    assertShop(snapshot.shopId, shopId);
    return snapshot;
  }

  // During the additive V2 ordering/settings rollout an otherwise healthy legacy shop may not
  // have a published V2 ordering projection yet. Preserve public browsing via V1, but only for
  // that temporary-unavailable boundary; do not mask not-found or generic backend failures.
  if (v2Response.status !== 503) throw new Error('catalog_public_unavailable');

  const v1Response = await requestCatalog(shopId, '1', signal);
  if (!v1Response.ok) throw new Error('catalog_public_unavailable');

  const snapshot = parsePublicCatalogSnapshotV1(await v1Response.json());
  assertShop(snapshot.shopId, shopId);
  return snapshot;
}

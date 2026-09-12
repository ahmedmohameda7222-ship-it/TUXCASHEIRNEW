import { parsePublicCatalogSnapshotV2, type PublicCatalogSnapshotV2 } from '@tux/catalog-contracts';

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

export async function fetchPublicCatalog(signal?: AbortSignal): Promise<PublicCatalogSnapshotV2> {
  const shopId = configuredShopId();
  const url = new URL(catalogPublicUrl());
  url.searchParams.set('shopId', shopId);
  url.searchParams.set('schemaVersion', '2');

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error('catalog_public_unavailable');

  const snapshot = parsePublicCatalogSnapshotV2(await response.json());
  if (snapshot.shopId !== shopId.toLowerCase()) {
    throw new Error('catalog_shop_mismatch');
  }
  return snapshot;
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersSource = readFileSync(new URL('../orders/useOrders.ts', import.meta.url), 'utf8');
const catalogSource = readFileSync(new URL('../catalog/useCatalog.ts', import.meta.url), 'utf8');

describe('external application changes become visible in Admin', () => {
  it('refreshes the scoped order list and selected order while the workspace is open', () => {
    expect(ordersSource).toContain('refetchInterval: ORDER_REFRESH_INTERVAL_MS');
    expect(ordersSource).toContain('const ORDER_REFRESH_INTERVAL_MS = 20_000;');
    expect(ordersSource).toContain('detailKey(shopId, selectedOrderId)');
  });

  it('refreshes catalog and publish status without switching shops', () => {
    expect(catalogSource).toContain('const CATALOG_REFRESH_INTERVAL_MS = 30_000;');
    expect(catalogSource.match(/refetchInterval: CATALOG_REFRESH_INTERVAL_MS/g)?.length).toBe(2);
    expect(catalogSource).toContain('catalogQueryKey(shopId)');
    expect(catalogSource).toContain('catalogPublishingQueryKey(shopId)');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { CatalogImageUploadError } from './catalogImageUpload';
import {
  assertCatalogImageProductScope,
  type CatalogImageProductReader,
} from './catalogImageProductScope';

const businessId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const otherShopId = '44444444-4444-4444-8444-444444444444';

function reader(
  live: unknown[],
  drafts: unknown[] = [],
): { client: CatalogImageProductReader; select: ReturnType<typeof vi.fn> } {
  const select = vi.fn(async (table: string) => (table === 'products' ? live : drafts));
  return { client: { select } as unknown as CatalogImageProductReader, select };
}

describe('catalog product-scoped image authorization', () => {
  it('allows a canonical product in the selected shop', async () => {
    const { client, select } = reader([{ id: productId, shop_id: shopId }]);
    await expect(
      assertCatalogImageProductScope(client, { businessId, shopId, productId }),
    ).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
    const params = select.mock.calls[0]?.[1] as URLSearchParams;
    expect(params.get('shop_id')).toBe(`eq.${shopId}`);
    expect(params.get('id')).toBe(`eq.${productId}`);
  });

  it('allows an unpublished product saved in a compatible shop draft', async () => {
    const { client, select } = reader(
      [],
      [
        {
          shop_id: shopId,
          business_id: businessId,
          status: 'DRAFT',
          working_bundle_json: {
            snapshot: { products: [{ id: productId, shopId }] },
          },
        },
      ],
    );
    await expect(
      assertCatalogImageProductScope(client, { businessId, shopId, productId }),
    ).resolves.toBeUndefined();
    const params = select.mock.calls[1]?.[1] as URLSearchParams;
    expect(params.get('business_id')).toBe(`eq.${businessId}`);
    expect(params.get('shop_id')).toBe(`eq.${shopId}`);
    expect(params.get('status')).toBe('eq.DRAFT');
  });

  it('rejects missing, foreign-shop, and inactive-draft products', async () => {
    for (const draft of [
      {
        shop_id: otherShopId,
        business_id: businessId,
        status: 'DRAFT',
        working_bundle_json: { snapshot: { products: [{ id: productId, shopId: otherShopId }] } },
      },
      {
        shop_id: shopId,
        business_id: businessId,
        status: 'PUBLISHED',
        working_bundle_json: { snapshot: { products: [{ id: productId, shopId }] } },
      },
      {
        shop_id: shopId,
        business_id: businessId,
        status: 'DRAFT',
        working_bundle_json: { snapshot: { products: [{ id: 'different', shopId }] } },
      },
    ]) {
      const { client } = reader([], [draft]);
      await expect(
        assertCatalogImageProductScope(client, { businessId, shopId, productId }),
      ).rejects.toMatchObject({ code: 'image_product_not_staged' });
    }
    await expect(
      assertCatalogImageProductScope(reader([]).client, { businessId, shopId, productId }),
    ).rejects.toBeInstanceOf(CatalogImageUploadError);
  });

  it('fails closed on malformed draft snapshots', async () => {
    const { client } = reader(
      [],
      [
        {
          shop_id: shopId,
          business_id: businessId,
          status: 'DRAFT',
          working_bundle_json: { snapshot: { products: 'invalid' } },
        },
      ],
    );
    await expect(
      assertCatalogImageProductScope(client, { businessId, shopId, productId }),
    ).rejects.toMatchObject({ code: 'image_product_not_staged' });
  });
});

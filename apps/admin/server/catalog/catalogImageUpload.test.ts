import { describe, expect, it, vi } from 'vitest';

import {
  CatalogImageUploadError,
  uploadCatalogProductImage,
  validateCatalogImageBytes,
} from './catalogImageUpload';

const businessId = '11111111-1111-4111-8111-111111111111';
const shopId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

describe('trusted catalog image uploads', () => {
  it('accepts real PNG/WebP/JPEG signatures and rejects spoofed SVG and mismatched formats', () => {
    expect(validateCatalogImageBytes('image/png', png)).toBe('png');
    expect(validateCatalogImageBytes('image/jpeg', Uint8Array.from([255, 216, 255, 0]))).toBe('jpg');
    expect(
      validateCatalogImageBytes(
        'image/webp',
        new TextEncoder().encode('RIFFxxxxWEBPxxx'),
      ),
    ).toBe('webp');
    expect(() => validateCatalogImageBytes('image/png', new TextEncoder().encode('<svg>'))).toThrow(
      CatalogImageUploadError,
    );
    expect(() => validateCatalogImageBytes('image/svg+xml', png)).toThrow(
      CatalogImageUploadError,
    );
    expect(() => validateCatalogImageBytes('image/jpeg', png)).toThrow(
      CatalogImageUploadError,
    );
  });

  it('rejects empty and oversized uploads before Storage can be called', () => {
    expect(() => validateCatalogImageBytes('image/png', new Uint8Array(0))).toThrow(
      CatalogImageUploadError,
    );
    expect(() => validateCatalogImageBytes('image/png', new Uint8Array(2 * 1024 * 1024 + 1))).toThrow(
      CatalogImageUploadError,
    );
  });

  it('uploads through a single service-key authenticated Storage call under a shop-scoped immutable key', async () => {
    const storageFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await uploadCatalogProductImage(
      {
        businessId,
        shopId,
        productId,
        contentType: 'image/png',
        bytes: png,
        supabaseUrl: 'https://example.supabase.co',
        serviceRoleKey: 'server-secret-do-not-leak',
      },
      storageFetch,
    );

    expect(result.imageKey).toMatch(
      new RegExp(`^${businessId}/${shopId}/${productId}/[0-9a-f-]{36}\\.png$`),
    );
    expect(result.publicUrl).toBe(
      `https://example.supabase.co/storage/v1/object/public/catalog-product-images/${result.imageKey}`,
    );
    expect(storageFetch).toHaveBeenCalledTimes(1);
    const [url, options] = storageFetch.mock.calls[0]!;
    expect(url).toContain('/storage/v1/object/catalog-product-images/');
    expect(options.method).toBe('POST');
    expect(options.headers.authorization).toBe('Bearer server-secret-do-not-leak');
    expect(options.headers['content-type']).toBe('image/png');
    expect(options.headers['x-upsert']).toBe('false');
    expect(options.body).toBeInstanceOf(Uint8Array);
  });

  it('does not return a successful image assignment when Storage rejects the upload', async () => {
    await expect(
      uploadCatalogProductImage(
        {
          businessId,
          shopId,
          productId,
          contentType: 'image/png',
          bytes: png,
          supabaseUrl: 'https://example.supabase.co',
          serviceRoleKey: 'server-secret',
        },
        vi.fn().mockResolvedValue({ ok: false, status: 413 }),
      ),
    ).rejects.toThrow(CatalogImageUploadError);
  });

  it('fails closed for a non-UUID business, shop, or product path', async () => {
    await expect(
      uploadCatalogProductImage(
        {
          businessId,
          shopId: '../other',
          productId,
          contentType: 'image/png',
          bytes: png,
          supabaseUrl: 'https://example.supabase.co',
          serviceRoleKey: 'server-secret',
        },
        vi.fn(),
      ),
    ).rejects.toThrow(CatalogImageUploadError);
  });
});

import { randomUUID } from 'node:crypto';

export class CatalogImageUploadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CatalogImageUploadError';
  }
}

export const MAX_CATALOG_IMAGE_BYTES = 2 * 1024 * 1024;
const CATALOG_IMAGE_BUCKET = 'catalog-product-images';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((letter, i) => bytes[offset + i] === letter.charCodeAt(0));
}

export function validateCatalogImageBytes(
  contentType: string,
  bytes: Uint8Array,
): 'png' | 'jpg' | 'webp' | 'avif' {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CATALOG_IMAGE_BYTES) {
    throw new CatalogImageUploadError('image_size_invalid');
  }
  if (
    contentType === 'image/png' &&
    bytes.byteLength >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  ) {
    return 'png';
  }
  if (
    contentType === 'image/jpeg' &&
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpg';
  }
  if (
    contentType === 'image/webp' &&
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 'RIFF') &&
    ascii(bytes, 8, 'WEBP')
  ) {
    return 'webp';
  }
  if (
    contentType === 'image/avif' &&
    bytes.byteLength >= 12 &&
    ascii(bytes, 4, 'ftyp') &&
    (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis'))
  ) {
    return 'avif';
  }
  throw new CatalogImageUploadError('image_format_invalid');
}

export type CatalogImageUploadInput = {
  businessId: string;
  shopId: string;
  productId: string;
  contentType: string;
  bytes: Uint8Array;
  supabaseUrl: string;
  serviceRoleKey: string;
};

export async function uploadCatalogProductImage(
  input: CatalogImageUploadInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ imageKey: string; publicUrl: string }> {
  if (![input.businessId, input.shopId, input.productId].every((id) => uuidPattern.test(id))) {
    throw new CatalogImageUploadError('image_scope_invalid');
  }
  const extension = validateCatalogImageBytes(input.contentType, input.bytes);
  const imageKey = `${input.businessId}/${input.shopId}/${input.productId}/${randomUUID()}.${extension}`;
  const origin = new URL(input.supabaseUrl).origin;
  const publicPath = `/storage/v1/object/public/${CATALOG_IMAGE_BUCKET}/${imageKey}`;
  const uploadPath = `/storage/v1/object/${CATALOG_IMAGE_BUCKET}/${imageKey}`;
  let response: Response;
  try {
    response = await fetchImpl(new URL(uploadPath, origin).toString(), {
      method: 'POST',
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        'content-type': input.contentType,
        'x-upsert': 'false',
        'cache-control': 'max-age=31536000',
      },
      body: Buffer.from(input.bytes),
    });
  } catch {
    throw new CatalogImageUploadError('image_storage_unavailable');
  }
  if (!response.ok) throw new CatalogImageUploadError('image_storage_unavailable');
  return { imageKey, publicUrl: new URL(publicPath, origin).toString() };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCatalogProductSlug(productId: string): string {
  const normalized = productId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error('invalid_product_id');
  return `product-${normalized}`;
}

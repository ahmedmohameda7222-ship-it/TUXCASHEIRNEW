import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CatalogModifierSource {
  standaloneProductId: string;
  name: string;
  priceMinor: number;
  active: boolean;
  sortOrder: number;
}

export interface CatalogRelationsManifest {
  schemaVersion: 1;
  shopId: string;
  extraCategoryId: string;
  modifierMaxQuantity: 1;
  modifiers: CatalogModifierSource[];
  eligibleProductIds: string[];
  comboProductIds: string[];
  beverageProductIds: string[];
}

export interface BuiltCatalogModifier extends CatalogModifierSource {
  id: string;
}

export interface BuiltProductModifierLink {
  productId: string;
  modifierId: string;
  maxQuantity: 1;
  sortOrder: number;
}

export interface BuiltComboBeverageOption {
  comboProductId: string;
  beverageProductId: string;
  sortOrder: number;
}

export interface BuiltCatalogRelationships {
  modifiers: BuiltCatalogModifier[];
  productModifierLinks: BuiltProductModifierLink[];
  comboBeverageOptions: BuiltComboBeverageOption[];
}

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} must be a UUID`);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function standaloneModifierId(shopId: string, standaloneProductId: string): string {
  assertUuid(shopId, 'shopId');
  assertUuid(standaloneProductId, 'standaloneProductId');

  const digest = createHash('sha1')
    .update(uuidBytes(shopId))
    .update(Buffer.from(`standalone-modifier:${standaloneProductId}`, 'utf8'))
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function validateCatalogRelationsManifest(manifest: CatalogRelationsManifest): void {
  if (manifest.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  assertUuid(manifest.shopId, 'shopId');
  assertUuid(manifest.extraCategoryId, 'extraCategoryId');
  if (manifest.modifierMaxQuantity !== 1) throw new Error('modifierMaxQuantity must be 1');
  if (manifest.modifiers.length !== 13) throw new Error('expected 13 modifiers');
  if (manifest.eligibleProductIds.length !== 36) throw new Error('expected 36 eligible products');
  if (manifest.comboProductIds.length !== 5) throw new Error('expected 5 combo products');
  if (manifest.beverageProductIds.length !== 2) throw new Error('expected 2 beverage products');

  const standaloneIds = manifest.modifiers.map((row) => row.standaloneProductId);
  const modifierSortOrders = manifest.modifiers.map((row) => row.sortOrder);
  assertUnique(standaloneIds, 'standalone Extra product identity');
  assertUnique(manifest.eligibleProductIds, 'eligible product identity');
  assertUnique(manifest.comboProductIds, 'combo product identity');
  assertUnique(manifest.beverageProductIds, 'beverage product identity');
  if (new Set(modifierSortOrders).size !== modifierSortOrders.length) {
    throw new Error('duplicate modifier sort order');
  }

  for (const row of manifest.modifiers) {
    assertUuid(row.standaloneProductId, 'standaloneProductId');
    if (row.name.trim().length === 0) throw new Error('modifier source name must not be empty');
    if (!Number.isSafeInteger(row.priceMinor) || row.priceMinor < 0) {
      throw new Error('modifier source price must be a non-negative safe integer');
    }
    if (typeof row.active !== 'boolean') throw new Error('modifier source active must be boolean');
    if (!Number.isSafeInteger(row.sortOrder) || row.sortOrder < 0) {
      throw new Error('modifier source sort order must be a non-negative integer');
    }
  }

  for (const id of manifest.eligibleProductIds) assertUuid(id, 'eligibleProductId');
  for (const id of manifest.comboProductIds) assertUuid(id, 'comboProductId');
  for (const id of manifest.beverageProductIds) assertUuid(id, 'beverageProductId');

  const eligible = new Set(manifest.eligibleProductIds);
  const extras = new Set(standaloneIds);
  if (manifest.eligibleProductIds.some((id) => extras.has(id))) {
    throw new Error('Extra products cannot be modifier-link target products');
  }
  if (manifest.comboProductIds.some((id) => !eligible.has(id))) {
    throw new Error('combo products must be eligible non-Extra products');
  }
  if (manifest.beverageProductIds.some((id) => !eligible.has(id))) {
    throw new Error('beverage products must be eligible non-Extra products');
  }

  const deterministicModifierIds = standaloneIds.map((id) => standaloneModifierId(manifest.shopId, id));
  assertUnique(deterministicModifierIds, 'deterministic modifier identity');
}

export function buildCatalogRelationships(
  manifest: CatalogRelationsManifest,
): BuiltCatalogRelationships {
  validateCatalogRelationsManifest(manifest);

  const modifiers = manifest.modifiers.map((source) => ({
    id: standaloneModifierId(manifest.shopId, source.standaloneProductId),
    ...source,
  }));

  const productModifierLinks = manifest.eligibleProductIds.flatMap((productId) =>
    modifiers.map((modifier) => ({
      productId,
      modifierId: modifier.id,
      maxQuantity: manifest.modifierMaxQuantity,
      sortOrder: modifier.sortOrder,
    })),
  );

  const comboBeverageOptions = manifest.comboProductIds.flatMap((comboProductId) =>
    manifest.beverageProductIds.map((beverageProductId, sortOrder) => ({
      comboProductId,
      beverageProductId,
      sortOrder,
    })),
  );

  return { modifiers, productModifierLinks, comboBeverageOptions };
}

import { createHash } from 'node:crypto';

export type LegacyDisposition = 'CREATE' | 'MATCH_EXPLICITLY' | 'SKIP_INTENTIONALLY' | 'ERROR';
export type LegacyImageDisposition =
  | 'BUNDLED_SOURCE_ASSET'
  | 'LEGACY_STORAGE_OBJECT'
  | 'CANONICAL_IMAGE_KEY'
  | 'NO_SOURCE_IMAGE';

export interface LegacyCategorySource {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface LegacyProductSource {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string;
  readonly price: number;
  readonly imageUrl: string | null;
  readonly imagePath: string | null;
  readonly bestSeller: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface LegacyCatalogSource {
  readonly categories: readonly LegacyCategorySource[];
  readonly products: readonly LegacyProductSource[];
}

export interface LegacyCategoryIdentityEntry {
  readonly legacyId: string;
  readonly disposition: LegacyDisposition;
  readonly canonicalId?: string;
  readonly reason?: string;
}

export interface LegacyProductIdentityEntry extends LegacyCategoryIdentityEntry {
  readonly categoryLegacyId: string;
  readonly imageDisposition: LegacyImageDisposition;
  readonly canonicalImageKey?: string;
}

export interface LegacyCatalogIdentityManifest {
  readonly version: 1;
  readonly source: string;
  readonly categoryCount: number;
  readonly productCount: number;
  readonly categories: readonly LegacyCategoryIdentityEntry[];
  readonly products: readonly LegacyProductIdentityEntry[];
}

export interface CanonicalLegacyCategory {
  readonly disposition: 'CREATE' | 'MATCH_EXPLICITLY';
  readonly legacyId: string;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface CanonicalLegacyProduct {
  readonly disposition: 'CREATE' | 'MATCH_EXPLICITLY';
  readonly legacyId: string;
  readonly id: string;
  readonly categoryId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly imageKey: string | null;
  readonly imageDisposition: LegacyImageDisposition;
  readonly bestSeller: boolean;
  readonly active: boolean;
  readonly soldOut: false;
  readonly isCombo: boolean;
  readonly sortOrder: number;
}

export interface LegacyCatalogMappingResult {
  readonly manifestVersion: 1;
  readonly source: string;
  readonly categories: readonly CanonicalLegacyCategory[];
  readonly products: readonly CanonicalLegacyProduct[];
  readonly skipped: readonly {
    readonly entity: 'category' | 'product';
    readonly legacyId: string;
    readonly disposition: 'SKIP_INTENTIONALLY';
    readonly reason: string;
  }[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_NAMESPACE_UUID = 'c2aac18a-7b91-5b59-a20c-2652dfa5131a';

function uuidBytes(uuid: string): Uint8Array {
  const compact = uuid.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error(`invalid UUID namespace: ${uuid}`);
  return Uint8Array.from(compact.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)));
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** RFC 4122 UUIDv5 derivation over a fixed, committed TUX migration namespace. */
export function deriveLegacyCatalogUuid(entity: 'category' | 'product', legacyId: string): string {
  const normalized = legacyId.trim();
  if (normalized === '') throw new Error('legacy identifier must not be empty');
  const namespace = uuidBytes(LEGACY_NAMESPACE_UUID);
  const name = new TextEncoder().encode(`${entity}:${normalized}`);
  const digest = createHash('sha1').update(namespace).update(name).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function priceMajorEgpToMinor(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('legacy price must be a finite non-negative number');
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded)) throw new Error('legacy price converts outside the safe integer range');
  if (Math.abs(scaled - rounded) > 1e-8) throw new Error('legacy price has more than two decimal places');
  return rounded;
}

function assertUniqueIds<T extends { readonly id: string }>(rows: readonly T[], entity: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`duplicate legacy ${entity} identifier: ${row.id}`);
    seen.add(row.id);
  }
}

function assertUniqueManifestIds<T extends { readonly legacyId: string }>(rows: readonly T[], entity: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.legacyId)) throw new Error(`duplicate ${entity} identity manifest entry: ${row.legacyId}`);
    seen.add(row.legacyId);
  }
}

function canonicalId(entity: 'category' | 'product', entry: LegacyCategoryIdentityEntry): string {
  if (entry.disposition === 'CREATE') return deriveLegacyCatalogUuid(entity, entry.legacyId);
  if (entry.disposition === 'MATCH_EXPLICITLY') {
    if (!entry.canonicalId || !UUID_PATTERN.test(entry.canonicalId)) {
      throw new Error(`${entity} ${entry.legacyId} MATCH_EXPLICITLY requires a valid canonicalId`);
    }
    return entry.canonicalId.toLowerCase();
  }
  throw new Error(`${entity} ${entry.legacyId} does not produce a canonical row`);
}

function skippedReason(entry: LegacyCategoryIdentityEntry): string {
  if (entry.disposition !== 'SKIP_INTENTIONALLY') throw new Error('not a skipped entry');
  if (!entry.reason?.trim()) throw new Error(`${entry.legacyId} SKIP_INTENTIONALLY requires a reason`);
  return entry.reason;
}

export function mapLegacyCatalog(
  source: LegacyCatalogSource,
  manifest: LegacyCatalogIdentityManifest,
): LegacyCatalogMappingResult {
  if (manifest.version !== 1) throw new Error('unsupported legacy catalog manifest version');
  assertUniqueIds(source.categories, 'category');
  assertUniqueIds(source.products, 'product');
  assertUniqueManifestIds(manifest.categories, 'category');
  assertUniqueManifestIds(manifest.products, 'product');

  if (source.categories.length !== manifest.categoryCount || source.products.length !== manifest.productCount) {
    throw new Error('legacy source/manifest count parity failed');
  }
  if (manifest.categories.length !== manifest.categoryCount || manifest.products.length !== manifest.productCount) {
    throw new Error('legacy identity manifest declared count parity failed');
  }

  const sourceCategoryById = new Map(source.categories.map((row) => [row.id, row]));
  const sourceProductById = new Map(source.products.map((row) => [row.id, row]));
  const categoryManifestById = new Map(manifest.categories.map((entry) => [entry.legacyId, entry]));
  const productManifestById = new Map(manifest.products.map((entry) => [entry.legacyId, entry]));

  for (const row of source.categories) {
    if (!categoryManifestById.has(row.id)) throw new Error(`missing source category mapping: ${row.id}`);
  }
  for (const row of source.products) {
    if (!productManifestById.has(row.id)) throw new Error(`missing source product mapping: ${row.id}`);
  }
  for (const entry of manifest.categories) {
    if (!sourceCategoryById.has(entry.legacyId)) throw new Error(`missing source category row: ${entry.legacyId}`);
    if (entry.disposition === 'ERROR') throw new Error(`category ${entry.legacyId} has ERROR disposition`);
  }
  for (const entry of manifest.products) {
    if (!sourceProductById.has(entry.legacyId)) throw new Error(`missing source product row: ${entry.legacyId}`);
    if (entry.disposition === 'ERROR') throw new Error(`product ${entry.legacyId} has ERROR disposition`);
  }

  const skipped: LegacyCatalogMappingResult['skipped'][number][] = [];
  const categoryCanonicalIdByLegacyId = new Map<string, string>();
  const categories: CanonicalLegacyCategory[] = [];

  for (const row of source.categories) {
    const entry = categoryManifestById.get(row.id)!;
    if (entry.disposition === 'SKIP_INTENTIONALLY') {
      skipped.push({ entity: 'category', legacyId: row.id, disposition: 'SKIP_INTENTIONALLY', reason: skippedReason(entry) });
      continue;
    }
    const id = canonicalId('category', entry);
    categoryCanonicalIdByLegacyId.set(row.id, id);
    categories.push({
      disposition: entry.disposition,
      legacyId: row.id,
      id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      sortOrder: row.sortOrder,
      active: row.active,
    });
  }

  const products: CanonicalLegacyProduct[] = [];
  for (const row of source.products) {
    const entry = productManifestById.get(row.id)!;
    if (entry.categoryLegacyId !== row.categoryId) {
      throw new Error(`product ${row.id} manifest category reference does not match source category identifier`);
    }
    const categoryId = categoryCanonicalIdByLegacyId.get(row.categoryId);
    if (!categoryId) throw new Error(`product ${row.id} references unknown legacy category ${row.categoryId}`);
    if (entry.disposition === 'SKIP_INTENTIONALLY') {
      skipped.push({ entity: 'product', legacyId: row.id, disposition: 'SKIP_INTENTIONALLY', reason: skippedReason(entry) });
      continue;
    }
    let imageKey: string | null = null;
    if (entry.imageDisposition === 'CANONICAL_IMAGE_KEY') {
      if (!entry.canonicalImageKey?.trim()) throw new Error(`product ${row.id} requires canonicalImageKey`);
      imageKey = entry.canonicalImageKey;
    }
    products.push({
      disposition: entry.disposition,
      legacyId: row.id,
      id: canonicalId('product', entry),
      categoryId,
      slug: row.id,
      name: row.name,
      description: row.description,
      priceMinor: priceMajorEgpToMinor(row.price),
      imageKey,
      imageDisposition: entry.imageDisposition,
      bestSeller: row.bestSeller,
      active: row.active,
      soldOut: false,
      isCombo: row.categoryId === 'combos',
      sortOrder: row.sortOrder,
    });
  }

  const canonicalIds = [...categories, ...products].map((row) => row.id);
  if (new Set(canonicalIds).size !== canonicalIds.length) throw new Error('duplicate canonical mapping detected');

  categories.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  products.sort((left, right) =>
    left.categoryId.localeCompare(right.categoryId) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
  skipped.sort((left, right) => left.entity.localeCompare(right.entity) || left.legacyId.localeCompare(right.legacyId));

  return { manifestVersion: 1, source: manifest.source, categories, products, skipped };
}

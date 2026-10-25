import type {
  CatalogJsonObject,
  CatalogJsonPrimitive,
  CatalogProductDetail,
  CatalogPublishEntityChange,
} from '@tux/admin-contracts';

export class CatalogPublishDiffError extends Error {
  constructor() {
    super('catalog_publish_diff_invalid_snapshot');
    this.name = 'CatalogPublishDiffError';
  }
}

type EntityKind = CatalogPublishEntityChange['kind'];
type PlainRecord = Readonly<Record<string, unknown>>;

const fieldsByKind: Record<EntityKind, readonly string[]> = {
  product: [
    'name',
    'description',
    'priceMinor',
    'categoryId',
    'slug',
    'imageKey',
    'family',
    'bestSeller',
    'active',
    'soldOut',
    'isCombo',
    'sortOrder',
  ],
  category: ['name', 'description', 'slug', 'active', 'sortOrder'],
  modifier: ['name', 'priceMinor', 'active', 'sortOrder'],
};

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collection(bundle: unknown, key: string): readonly unknown[] {
  if (!isRecord(bundle) || !isRecord(bundle['snapshot'])) {
    throw new CatalogPublishDiffError();
  }
  const values = bundle['snapshot'][key];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new CatalogPublishDiffError();
  return values;
}

function normalized(
  row: PlainRecord,
  fields: readonly string[],
): CatalogJsonObject {
  const result: CatalogJsonObject = {};
  for (const field of fields) {
    const value = row[field];
    if (value === undefined || value === null) {
      result[field] = null;
    } else if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      result[field] = value as CatalogJsonPrimitive;
    } else {
      throw new CatalogPublishDiffError();
    }
  }
  return result;
}

function mapRows(
  rows: readonly unknown[],
  shopId: string,
  kind: EntityKind,
): Map<string, CatalogJsonObject> {
  const result = new Map<string, CatalogJsonObject>();
  for (const value of rows) {
    if (!isRecord(value) || value['shopId'] !== shopId) throw new CatalogPublishDiffError();
    const id = value['id'];
    if (typeof id !== 'string' || !id || result.has(id))
      throw new CatalogPublishDiffError();
    result.set(id, normalized(value, fieldsByKind[kind]));
  }
  return result;
}

function diff(
  kind: EntityKind,
  before: Map<string, CatalogJsonObject>,
  after: Map<string, CatalogJsonObject>,
): CatalogPublishEntityChange[] {
  const allIds = [...new Set([...before.keys(), ...after.keys()])].sort();
  return allIds.map((id) => {
    const older = before.get(id) ?? null;
    const newer = after.get(id) ?? null;
    const changedFields = fieldsByKind[kind].filter(
      (field) => older?.[field] !== newer?.[field],
    );
    const status = !older
      ? 'added'
      : !newer
        ? 'removed'
        : changedFields.length
          ? 'modified'
          : 'unchanged';
    return { kind, id, status, before: older, after: newer, changedFields };
  });
}

export function buildCatalogPublishDiffs(
  shopId: string,
  liveProducts: readonly CatalogProductDetail[],
  draftBundle: unknown,
  publishedBundle: unknown,
): CatalogPublishEntityChange[] {
  const productsBefore = mapRows(liveProducts, shopId, 'product');
  const productsAfter = mapRows(collection(draftBundle, 'products'), shopId, 'product');
  const categoriesBefore = mapRows(collection(publishedBundle, 'categories'), shopId, 'category');
  const categoriesAfter = mapRows(collection(draftBundle, 'categories'), shopId, 'category');
  const modifiersBefore = mapRows(collection(publishedBundle, 'modifiers'), shopId, 'modifier');
  const modifiersAfter = mapRows(collection(draftBundle, 'modifiers'), shopId, 'modifier');
  return [
    ...diff('product', productsBefore, productsAfter),
    ...diff('category', categoriesBefore, categoriesAfter),
    ...diff('modifier', modifiersBefore, modifiersAfter),
  ];
}

import type { CatalogJsonObject, CatalogJsonValue } from '@tux/admin-contracts';

export type CatalogDefinitionCollection = 'categories' | 'modifiers';

function objectValue(value: CatalogJsonValue | undefined): CatalogJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('catalog_bundle_invalid');
  }
  return value;
}

export function catalogDefinitionsFromBundle(
  bundle: CatalogJsonObject,
  collection: CatalogDefinitionCollection,
): CatalogJsonObject[] {
  const snapshot = objectValue(bundle['snapshot']);
  const definitions = snapshot[collection];
  if (!Array.isArray(definitions)) throw new Error('catalog_bundle_invalid');
  return definitions.map(objectValue);
}

/** Use the same draft bundle as products, recipes and published Menu/Operations configuration. */
export function upsertCatalogDefinitionInBundle(
  bundle: CatalogJsonObject,
  collection: CatalogDefinitionCollection,
  definition: CatalogJsonObject,
): CatalogJsonObject {
  const snapshot = objectValue(bundle['snapshot']);
  const current = catalogDefinitionsFromBundle(bundle, collection);
  const id = definition['id'];
  const shopId = definition['shopId'];
  const name = definition['name'];
  const sortOrder = definition['sortOrder'];
  if (typeof id !== 'string' || !id || typeof shopId !== 'string' || !shopId
      || typeof name !== 'string' || !name.trim() || name.length > 160
      || typeof definition['active'] !== 'boolean'
      || typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    throw new Error('invalid_catalog_definition');
  }
  if (collection === 'modifiers' &&
      (typeof definition['priceMinor'] !== 'number' ||
       !Number.isSafeInteger(definition['priceMinor']) ||
       definition['priceMinor'] < 0)) {
    throw new Error('invalid_modifier_price');
  }
  if (collection === 'categories' &&
      (definition['description'] !== null && typeof definition['description'] !== 'string')) {
    throw new Error('invalid_catalog_category');
  }

  const firstKnownShop = (
    ['categories', 'products', 'modifiers'] as const
  ).flatMap((key) => Array.isArray(snapshot[key]) ? (snapshot[key] as CatalogJsonValue[]) : [])
    .map((value) => objectValue(value)['shopId'])
    .find((value) => typeof value === 'string');
  if (firstKnownShop !== undefined && firstKnownShop !== shopId) {
    throw new Error('catalog_shop_mismatch');
  }

  const index = current.findIndex((candidate) => candidate['id'] === id);
  const next = [...current];
  if (index < 0) next.push(definition);
  else next[index] = { ...next[index], ...definition };
  return {
    ...bundle,
    snapshot: {
      ...snapshot,
      [collection]: next,
    },
  };
}

/**
 * One draft-bundle replacement repositions every sibling, avoiding order ties
 * when the first persisted sortOrder is zero or rows have adjacent values.
 */
export function reorderCatalogDefinitionsInBundle(
  bundle: CatalogJsonObject,
  collection: CatalogDefinitionCollection,
  orderedIds: readonly string[],
): CatalogJsonObject {
  const snapshot = objectValue(bundle['snapshot']);
  const current = catalogDefinitionsFromBundle(bundle, collection);
  const ids = new Set(current.map((item) => item['id']));
  if (ids.size !== current.length || ids.size !== orderedIds.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !ids.has(id))) {
    throw new Error('invalid_catalog_definition_order');
  }
  const byId = new Map(current.map((item) => [item['id'], item]));
  const next = orderedIds.map((id, index) => ({
    ...byId.get(id)!,
    sortOrder: index * 10,
  }));
  return { ...bundle, snapshot: { ...snapshot, [collection]: next } };
}

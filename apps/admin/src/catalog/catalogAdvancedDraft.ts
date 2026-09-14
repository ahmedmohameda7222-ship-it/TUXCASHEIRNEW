import type { CatalogJsonObject, CatalogJsonValue } from '@tux/admin-contracts';

export type ProductModifierLinkDraft = {
  shopId: string;
  productId: string;
  modifierId: string;
  maxQuantity: number | null;
  sortOrder: number;
};

export type ComboBeverageOptionDraft = {
  shopId: string;
  comboProductId: string;
  beverageProductId: string;
  sortOrder: number;
};

export type RecipeLineDraft = {
  shopId: string;
  productId: string;
  inventoryItemId: string;
  quantityMicros: number;
};

export type ProductAdvancedDraft = {
  modifierLinks: ProductModifierLinkDraft[];
  comboBeverageOptions: ComboBeverageOptionDraft[];
  recipeLines: RecipeLineDraft[];
};

export type ProductAdvancedModel = {
  modifiers: Array<{
    id: string;
    name: string;
    active: boolean;
    linked: boolean;
    maxQuantity: number | null;
    sortOrder: number;
  }>;
  comboOptions: Array<{
    productId: string;
    name: string;
    active: boolean;
    selected: boolean;
    sortOrder: number;
  }>;
  inventoryItems: Array<{
    inventoryItemId: string;
    name: string;
    unitLabel: string;
    active: boolean;
    quantityMicros: number | null;
  }>;
};

function isJsonObject(value: CatalogJsonValue | undefined): value is CatalogJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relationArray(container: CatalogJsonObject, key: string): CatalogJsonValue[] {
  const value = container[key];
  if (!Array.isArray(value)) throw new Error('catalog_bundle_invalid');
  return value;
}

function stringField(source: CatalogJsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error('catalog_bundle_invalid');
  return value;
}

function booleanField(source: CatalogJsonObject, key: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw new Error('catalog_bundle_invalid');
  return value;
}

function integerField(source: CatalogJsonObject, key: string, minimum = 0): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error('catalog_bundle_invalid');
  }
  return value;
}

function nullablePositiveIntegerField(source: CatalogJsonObject, key: string): number | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('catalog_bundle_invalid');
  }
  return value;
}

function objectValue(value: CatalogJsonValue): CatalogJsonObject {
  if (!isJsonObject(value)) throw new Error('catalog_bundle_invalid');
  return value;
}

function belongsToProduct(value: CatalogJsonValue, key: string, productId: string): boolean {
  return isJsonObject(value) && value[key] === productId;
}

function jsonModifierLink(value: ProductModifierLinkDraft): CatalogJsonObject {
  return {
    shopId: value.shopId,
    productId: value.productId,
    modifierId: value.modifierId,
    maxQuantity: value.maxQuantity,
    sortOrder: value.sortOrder,
  };
}

function jsonComboOption(value: ComboBeverageOptionDraft): CatalogJsonObject {
  return {
    shopId: value.shopId,
    comboProductId: value.comboProductId,
    beverageProductId: value.beverageProductId,
    sortOrder: value.sortOrder,
  };
}

function jsonRecipeLine(value: RecipeLineDraft): CatalogJsonObject {
  return {
    shopId: value.shopId,
    productId: value.productId,
    inventoryItemId: value.inventoryItemId,
    quantityMicros: value.quantityMicros,
  };
}

export function readProductAdvancedModel(
  bundleJson: CatalogJsonObject,
  productId: string,
): ProductAdvancedModel {
  const snapshot = bundleJson.snapshot;
  if (!isJsonObject(snapshot)) throw new Error('catalog_bundle_invalid');

  const modifiers = relationArray(snapshot, 'modifiers');
  const modifierLinks = relationArray(snapshot, 'productModifierLinks');
  const products = relationArray(snapshot, 'products');
  const comboOptions = relationArray(snapshot, 'comboBeverageOptions');
  const recipeLines = relationArray(snapshot, 'recipeLines');
  const inventoryItems = relationArray(bundleJson, 'inventoryItems');

  const currentModifierLinks = new Map<string, CatalogJsonObject>();
  for (const rawLink of modifierLinks) {
    const link = objectValue(rawLink);
    if (link.productId !== productId) continue;
    currentModifierLinks.set(stringField(link, 'modifierId'), link);
  }

  const currentComboOptions = new Map<string, CatalogJsonObject>();
  for (const rawOption of comboOptions) {
    const option = objectValue(rawOption);
    if (option.comboProductId !== productId) continue;
    currentComboOptions.set(stringField(option, 'beverageProductId'), option);
  }

  const currentRecipeLines = new Map<string, CatalogJsonObject>();
  for (const rawLine of recipeLines) {
    const line = objectValue(rawLine);
    if (line.productId !== productId) continue;
    currentRecipeLines.set(stringField(line, 'inventoryItemId'), line);
  }

  const modifierModel = modifiers
    .map((rawModifier) => {
      const modifier = objectValue(rawModifier);
      const id = stringField(modifier, 'id');
      const active = booleanField(modifier, 'active');
      const link = currentModifierLinks.get(id);
      return {
        id,
        name: stringField(modifier, 'name'),
        active,
        linked: link !== undefined,
        maxQuantity: link === undefined ? null : nullablePositiveIntegerField(link, 'maxQuantity'),
        sortOrder: link === undefined ? integerField(modifier, 'sortOrder') : integerField(link, 'sortOrder'),
      };
    })
    .filter((modifier) => modifier.active || modifier.linked)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  const comboModel = products
    .map((rawProduct) => {
      const product = objectValue(rawProduct);
      const id = stringField(product, 'id');
      if (id === productId) return null;
      const active = booleanField(product, 'active');
      const option = currentComboOptions.get(id);
      return {
        productId: id,
        name: stringField(product, 'name'),
        active,
        selected: option !== undefined,
        sortOrder: option === undefined ? integerField(product, 'sortOrder') : integerField(option, 'sortOrder'),
      };
    })
    .filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== null && (candidate.active || candidate.selected),
    )
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));

  const inventoryModel = inventoryItems
    .map((rawItem) => {
      const item = objectValue(rawItem);
      const id = stringField(item, 'id');
      const active = booleanField(item, 'active');
      const line = currentRecipeLines.get(id);
      return {
        inventoryItemId: id,
        name: stringField(item, 'name'),
        unitLabel: stringField(item, 'unitLabel'),
        active,
        quantityMicros: line === undefined ? null : integerField(line, 'quantityMicros', 1),
      };
    })
    .filter((item) => item.active || item.quantityMicros !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    modifiers: modifierModel,
    comboOptions: comboModel,
    inventoryItems: inventoryModel,
  };
}

export function applyProductAdvancedDraft(
  bundleJson: CatalogJsonObject,
  productId: string,
  draft: ProductAdvancedDraft,
): { bundleJson: CatalogJsonObject; changedPaths: string[] } {
  const snapshot = bundleJson.snapshot;
  if (!isJsonObject(snapshot)) throw new Error('catalog_bundle_invalid');

  const productModifierLinks = relationArray(snapshot, 'productModifierLinks');
  const comboBeverageOptions = relationArray(snapshot, 'comboBeverageOptions');
  const recipeLines = relationArray(snapshot, 'recipeLines');

  return {
    bundleJson: {
      ...bundleJson,
      snapshot: {
        ...snapshot,
        productModifierLinks: [
          ...productModifierLinks.filter(
            (value) => !belongsToProduct(value, 'productId', productId),
          ),
          ...draft.modifierLinks.map(jsonModifierLink),
        ],
        comboBeverageOptions: [
          ...comboBeverageOptions.filter(
            (value) => !belongsToProduct(value, 'comboProductId', productId),
          ),
          ...draft.comboBeverageOptions.map(jsonComboOption),
        ],
        recipeLines: [
          ...recipeLines.filter((value) => !belongsToProduct(value, 'productId', productId)),
          ...draft.recipeLines.map(jsonRecipeLine),
        ],
      },
    },
    changedPaths: ['productModifierLinks', 'comboBeverageOptions', 'recipeLines'],
  };
}

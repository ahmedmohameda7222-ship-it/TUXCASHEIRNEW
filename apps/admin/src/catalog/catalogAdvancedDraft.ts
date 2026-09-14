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

function isJsonObject(value: CatalogJsonValue | undefined): value is CatalogJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function relationArray(snapshot: CatalogJsonObject, key: string): CatalogJsonValue[] {
  const value = snapshot[key];
  if (!Array.isArray(value)) throw new Error('catalog_bundle_invalid');
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

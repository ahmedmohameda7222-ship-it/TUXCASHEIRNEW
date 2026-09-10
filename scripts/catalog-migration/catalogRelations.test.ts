import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildCatalogRelationships,
  validateCatalogRelationsManifest,
  type CatalogRelationsManifest,
} from './catalogRelations';

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./catalog-relations-manifest.json', import.meta.url)),
    'utf8',
  ),
) as CatalogRelationsManifest;

function cloneManifest(): CatalogRelationsManifest {
  return structuredClone(manifest);
}

describe('production catalog modifier and combo relationship authority', () => {
  it('is explicit and expands to the approved 13 modifiers / 468 links / 10 combo options', () => {
    expect(() => validateCatalogRelationsManifest(manifest)).not.toThrow();

    expect(manifest.shopId).toBe('c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46');
    expect(manifest.extraCategoryId).toBe('c55b48e4-4dec-5cfc-a179-ab93a911542b');
    expect(manifest.modifierMaxQuantity).toBe(1);
    expect(manifest.modifiers).toHaveLength(13);
    expect(manifest.eligibleProductIds).toHaveLength(36);
    expect(manifest.comboProductIds).toHaveLength(5);
    expect(manifest.beverageProductIds).toHaveLength(2);

    const relationships = buildCatalogRelationships(manifest);
    expect(relationships.modifiers).toHaveLength(13);
    expect(relationships.productModifierLinks).toHaveLength(468);
    expect(relationships.comboBeverageOptions).toHaveLength(10);
  });

  it('keeps each modifier canonically paired to one standalone Extra with the same source business fields', () => {
    const relationships = buildCatalogRelationships(manifest);
    const sourceById = new Map(manifest.modifiers.map((row) => [row.standaloneProductId, row]));

    for (const modifier of relationships.modifiers) {
      const source = sourceById.get(modifier.standaloneProductId);
      expect(source).toBeDefined();
      expect(modifier.name).toBe(source!.name);
      expect(modifier.priceMinor).toBe(source!.priceMinor);
      expect(modifier.active).toBe(source!.active);
      expect(modifier.sortOrder).toBe(source!.sortOrder);
      expect(modifier.id).toMatch(/^[0-9a-f-]{36}$/);
    }

    expect(new Set(relationships.modifiers.map((row) => row.id)).size).toBe(13);
  });

  it('offers every Extra exactly once to every non-Extra product and never to an Extra product', () => {
    const relationships = buildCatalogRelationships(manifest);
    const extraProductIds = new Set(manifest.modifiers.map((row) => row.standaloneProductId));

    expect(
      relationships.productModifierLinks.every(
        (link) =>
          manifest.eligibleProductIds.includes(link.productId) &&
          !extraProductIds.has(link.productId) &&
          link.maxQuantity === 1,
      ),
    ).toBe(true);

    for (const productId of manifest.eligibleProductIds) {
      const links = relationships.productModifierLinks.filter((link) => link.productId === productId);
      expect(links).toHaveLength(13);
      expect(new Set(links.map((link) => link.modifierId)).size).toBe(13);
    }
  });

  it('offers both current beverages to every current combo and only those combinations', () => {
    const relationships = buildCatalogRelationships(manifest);

    for (const comboProductId of manifest.comboProductIds) {
      const options = relationships.comboBeverageOptions.filter(
        (option) => option.comboProductId === comboProductId,
      );
      expect(options).toHaveLength(2);
      expect(options.map((option) => option.beverageProductId).sort()).toEqual(
        [...manifest.beverageProductIds].sort(),
      );
    }
  });

  it('fails closed on duplicates, overlap, wrong counts, or mutable source identity', () => {
    const duplicateEligible = cloneManifest();
    duplicateEligible.eligibleProductIds[1] = duplicateEligible.eligibleProductIds[0]!;
    expect(() => validateCatalogRelationsManifest(duplicateEligible)).toThrow(/duplicate/i);

    const extraEligible = cloneManifest();
    extraEligible.eligibleProductIds[0] = extraEligible.modifiers[0]!.standaloneProductId;
    expect(() => validateCatalogRelationsManifest(extraEligible)).toThrow(/extra/i);

    const missingCombo = cloneManifest();
    missingCombo.comboProductIds.pop();
    expect(() => validateCatalogRelationsManifest(missingCombo)).toThrow(/5 combo/i);

    const missingBeverage = cloneManifest();
    missingBeverage.beverageProductIds.pop();
    expect(() => validateCatalogRelationsManifest(missingBeverage)).toThrow(/2 beverage/i);

    const invalidPrice = cloneManifest();
    invalidPrice.modifiers[0]!.priceMinor = -1;
    expect(() => validateCatalogRelationsManifest(invalidPrice)).toThrow(/price/i);
  });
});

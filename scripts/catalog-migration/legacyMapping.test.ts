import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveLegacyCatalogUuid,
  mapLegacyCatalog,
  priceMajorEgpToMinor,
  type LegacyCatalogIdentityManifest,
  type LegacyCatalogSource,
} from './legacyMapping';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('./legacy-catalog-identity-manifest.json', import.meta.url)), 'utf8'),
) as LegacyCatalogIdentityManifest;

const source: LegacyCatalogSource = {
  categories: [
    { id: 'tux-burger', name: 'Tux Burger', slug: 'tux-burger', description: null, sortOrder: 1, active: true },
    { id: 'fries', name: 'Fries', slug: 'fries', description: null, sortOrder: 4, active: true },
  ],
  products: [
    {
      id: 'single-tux-burger', categoryId: 'tux-burger', name: 'Single Tux Burger',
      description: 'The classic Tux.', price: 190, imageUrl: '/src/assets/tux.svg', imagePath: null,
      bestSeller: true, active: true, sortOrder: 1,
    },
    {
      id: 'classic-fries-small', categoryId: 'fries', name: 'Classic Fries Small',
      description: 'Crispy golden French fries.', price: 30, imageUrl: '/src/assets/tux.svg', imagePath: null,
      bestSeller: false, active: true, sortOrder: 1,
    },
  ],
};

function subsetManifest(): LegacyCatalogIdentityManifest {
  return {
    version: 1,
    source: manifest.source,
    categoryCount: 2,
    productCount: 2,
    categories: manifest.categories.filter((entry) => ['tux-burger', 'fries'].includes(entry.legacyId)),
    products: manifest.products.filter((entry) => ['single-tux-burger', 'classic-fries-small'].includes(entry.legacyId)),
  };
}

describe('legacy catalog money conversion', () => {
  it('converts EGP major units to exact integer minor units', () => {
    expect(priceMajorEgpToMinor(190)).toBe(19000);
    expect(priceMajorEgpToMinor(190.5)).toBe(19050);
    expect(priceMajorEgpToMinor(0)).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.001, Number.MAX_SAFE_INTEGER])(
    'rejects malformed/unsafe price %s',
    (value) => expect(() => priceMajorEgpToMinor(value)).toThrow(),
  );
});

describe('legacy identity mapping', () => {
  it('derives stable canonical UUIDs from immutable legacy identifiers, not names', () => {
    expect(deriveLegacyCatalogUuid('category', 'tux-burger')).toBe(
      deriveLegacyCatalogUuid('category', 'tux-burger'),
    );
    expect(deriveLegacyCatalogUuid('category', 'same-name-a')).not.toBe(
      deriveLegacyCatalogUuid('category', 'same-name-b'),
    );
    expect(deriveLegacyCatalogUuid('category', 'tux-burger')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('preserves public slugs, explicit category references, counts, and deterministic output', () => {
    const first = mapLegacyCatalog(source, subsetManifest());
    const second = mapLegacyCatalog(source, subsetManifest());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.categories).toHaveLength(2);
    expect(first.products).toHaveLength(2);
    expect(first.categories[0]?.slug).toBe('tux-burger');
    expect(first.products[0]?.slug).toBe('single-tux-burger');
    expect(first.products[0]?.categoryId).toBe(first.categories[0]?.id);
    expect(first.products[0]?.priceMinor).toBe(19000);
    expect(new Set([...first.categories, ...first.products].map((row) => row.id)).size).toBe(4);
  });

  it('fails closed for a duplicate legacy category identifier', () => {
    expect(() => mapLegacyCatalog(
      { ...source, categories: [...source.categories, source.categories[0]!] },
      subsetManifest(),
    )).toThrow(/duplicate legacy category/i);
  });

  it('fails closed for a duplicate legacy product identifier', () => {
    expect(() => mapLegacyCatalog(
      { ...source, products: [...source.products, source.products[0]!] },
      subsetManifest(),
    )).toThrow(/duplicate legacy product/i);
  });

  it('fails closed when source and manifest category references disagree without display-name fallback', () => {
    const broken = {
      ...source,
      products: [
        { ...source.products[0]!, categoryId: 'not-a-known-id', name: 'Tux Burger' },
        ...source.products.slice(1),
      ],
    };
    expect(() => mapLegacyCatalog(broken, subsetManifest())).toThrow(
      /manifest category reference does not match source category identifier/i,
    );
  });

  it('fails closed for an unknown product category reference without display-name fallback', () => {
    const brokenSource = {
      ...source,
      products: [
        { ...source.products[0]!, categoryId: 'not-a-known-id', name: 'Tux Burger' },
        ...source.products.slice(1),
      ],
    };
    const baseManifest = subsetManifest();
    const brokenManifest: LegacyCatalogIdentityManifest = {
      ...baseManifest,
      products: baseManifest.products.map((entry) =>
        entry.legacyId === 'single-tux-burger'
          ? { ...entry, categoryLegacyId: 'not-a-known-id' }
          : entry,
      ),
    };
    expect(() => mapLegacyCatalog(brokenSource, brokenManifest)).toThrow(/unknown legacy category/i);
  });

  it('fails closed when manifest/source parity is not exact', () => {
    expect(() => mapLegacyCatalog(
      { categories: source.categories.slice(0, 1), products: source.products },
      subsetManifest(),
    )).toThrow(/count parity|missing source/i);
  });
});

describe('checked-in legacy identity manifest', () => {
  it('accounts for the current imported fallback catalog exactly: 7 categories and 38 products', () => {
    expect(manifest.categoryCount).toBe(7);
    expect(manifest.productCount).toBe(38);
    expect(manifest.categories).toHaveLength(7);
    expect(manifest.products).toHaveLength(38);
    expect(new Set(manifest.categories.map((entry) => entry.legacyId)).size).toBe(7);
    expect(new Set(manifest.products.map((entry) => entry.legacyId)).size).toBe(38);
    expect(manifest.categories.every((entry) => entry.disposition === 'CREATE')).toBe(true);
    expect(manifest.products.every((entry) => entry.disposition === 'CREATE')).toBe(true);
  });
});

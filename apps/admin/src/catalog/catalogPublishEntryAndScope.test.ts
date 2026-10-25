import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const catalog = readFileSync(resolve(import.meta.dirname, 'CatalogPage.tsx'), 'utf8');

describe('Catalog shop-scoped publishing entry point', () => {
  it('makes Review & Publish discoverable from the main Catalog screen', () => {
    expect(catalog).toContain("requestCatalogNavigation('/catalog/products/publishing')");
    expect(catalog).toContain('Review & Publish');
    expect(catalog).toContain('catalog.compatibleDrafts.length');
    expect(catalog).toContain('currentPublishVersion');
    expect(catalog).toContain('Save Draft');
    expect(catalog).toContain('Publish Now');
  });

  it("does not render another shop's unsaved product while scope changes", () => {
    expect(catalog).toContain('unsavedProduct?.shopId === shopId');
    expect(catalog).toContain('product.shopId === shopId');
    expect(catalog).toContain('setUnsavedProduct(null)');
  });

  it('offers a clear next action after saving a product draft', () => {
    expect(catalog).toContain('Draft saved');
    expect(catalog).toContain('Review & Publish');
  });

  it('does not discard an unsaved product or definition through catalog quick actions', () => {
    const between = (start: string, end: string) => {
      const startAt = catalog.indexOf(start);
      const endAt = catalog.indexOf(end, startAt + start.length);
      expect(startAt).toBeGreaterThanOrEqual(0);
      expect(endAt).toBeGreaterThan(startAt);
      return catalog.slice(startAt, endAt);
    };
    expect(between('function canSwitchCatalogEditor', 'function openProduct')).toContain(
      'hasUnsavedDrafts()',
    );
    expect(between('function openProduct', 'function handleCategoryFilterChange')).toContain(
      'if (!canSwitchCatalogEditor()) return;',
    );
    expect(between('function startNewProduct', 'function closeEditor')).toContain(
      'if (!canSwitchCatalogEditor()) return;',
    );
    expect(between('function closeEditor', 'if (!shopId)')).toContain(
      "window.confirm('Discard your unsaved product edits?')",
    );
    expect(catalog).toContain('if (busy || !canSwitchCatalogEditor()) return;');
    expect(catalog).toContain('if (!bulkOpen && !canSwitchCatalogEditor()) return;');
    expect(catalog).toContain("setPendingNavigation(destination)");
    expect(catalog).toContain("document.addEventListener('click', interceptLink, true)");
    expect(catalog).toContain("window.addEventListener('popstate', onPopstate, true)");
    expect(catalog).toContain("window.addEventListener('beforeunload', onBeforeUnload)");
  });
});

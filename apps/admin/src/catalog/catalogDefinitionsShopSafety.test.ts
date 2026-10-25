import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Catalog category and modifier scope safety', () => {
  it('registers a draft guard for category and modifier editors', () => {
    const editor = readFileSync(
      resolve(import.meta.dirname, 'CatalogDefinitionsEditor.tsx'),
      'utf8',
    );
    expect(editor).toContain('useUnsavedShopDraft(editor !== null)');
  });

  it('remounts the definitions editor on a concrete shop transition', () => {
    const page = readFileSync(resolve(import.meta.dirname, 'CatalogPage.tsx'), 'utf8');
    expect(page).toContain('<CatalogDefinitionsEditor\n          key={shopId}');
  });
});

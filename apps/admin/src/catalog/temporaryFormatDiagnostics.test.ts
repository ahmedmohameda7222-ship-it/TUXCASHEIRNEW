import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { it } from 'vitest';

it('exports exact Prettier output for catalog image editor changes', async () => {
  const paths = [
    'apps/admin/api/admin/catalog-image.ts',
    'apps/admin/server/catalog/catalogImageUpload.test.ts',
    'apps/admin/src/catalog/ProductEditor.tsx',
    'apps/admin/src/catalog/catalogImageEditor.test.tsx',
    'apps/admin/src/catalog/CatalogPage.tsx',
    'apps/admin/src/catalog/ProductInspector.tsx',
  ];
  for (const path of paths) {
    const original = readFileSync(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) ?? {};
    const formatted = await prettier.format(original, { ...config, filepath: path });
    if (formatted === original) continue;
    const encoded = encodeURIComponent(formatted);
    for (let start = 0; start < encoded.length; start += 900) {
      console.log(`TUXFMT|${path}|${start}|${encoded.slice(start, start + 900)}`);
    }
  }
});

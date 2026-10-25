import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { it } from 'vitest';

it('prints formatted copies for controlled release verification', async () => {
  const paths = [
    'apps/admin/src/catalog/BulkProductEditor.tsx',
    'apps/admin/src/catalog/CatalogPage.tsx',
    'apps/admin/src/catalog/catalogBulkEdit.test.ts',
    'apps/admin/src/catalog/catalogBulkEdit.ts',
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

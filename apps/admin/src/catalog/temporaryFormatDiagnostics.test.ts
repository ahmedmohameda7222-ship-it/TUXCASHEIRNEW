import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { it } from 'vitest';

it('exports Catalog first-run exact formatting', async () => {
  const path = 'apps/admin/src/catalog/CatalogFirstRunGuide.tsx';
  const original = readFileSync(path, 'utf8');
  const config = (await prettier.resolveConfig(path)) ?? {};
  const encoded = encodeURIComponent(await prettier.format(original, { ...config, filepath: path }));
  for (let start = 0; start < encoded.length; start += 900) {
    console.log(`TUXFMT|${path}|${start}|${encoded.slice(start, start + 900)}`);
  }
});

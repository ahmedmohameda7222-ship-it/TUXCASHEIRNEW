import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { it } from 'vitest';

it('exports exact Prettier output for the Catalog PR corrections', async () => {
  const paths = [
    'apps/admin/server/catalog/catalogPublishDiff.test.ts',
    'apps/admin/server/catalog/catalogPublishDiff.ts',
    'apps/admin/server/catalog/catalogService.ts',
    'apps/admin/src/catalog/PublishReviewChanges.tsx',
    'apps/admin/src/catalog/PublishReviewPage.tsx',
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

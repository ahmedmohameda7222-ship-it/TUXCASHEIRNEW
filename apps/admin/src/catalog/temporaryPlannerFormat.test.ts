import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as prettier from 'prettier';
import { describe, it } from 'vitest';

describe('temporary Planner correction formatting', () => {
  it('captures exact CatalogPage formatting using locked Prettier', async () => {
    const file = resolve(process.cwd(), 'apps/admin/src/catalog/CatalogPage.tsx');
    const formatted = await prettier.format(readFileSync(file, 'utf8'), {
      ...(await prettier.resolveConfig(file)),
      filepath: file,
    });
    console.log('TUX_CATALOG_FMT_START' + Buffer.from(formatted).toString('base64') + 'TUX_CATALOG_FMT_END');
  });
});

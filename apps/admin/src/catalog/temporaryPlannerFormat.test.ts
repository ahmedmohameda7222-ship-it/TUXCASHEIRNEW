import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as prettier from 'prettier';
import { describe, it } from 'vitest';

describe('temporary catalog review formatter', () => {
  it('prints exact configured Prettier output for final CI repair', async () => {
    for (const [i, name] of [
      'apps/admin/src/catalog/CatalogPage.tsx',
      'apps/admin/src/catalog/ProductEditor.tsx',
      'apps/admin/src/catalog/catalogPublishEntryAndScope.test.ts',
      'apps/admin/src/catalog/publishReviewIdentity.test.ts',
      'e2e/admin-catalog-publish-review-identity.e2e.ts',
      'e2e/admin-catalog.spec.ts',
    ].entries()) {
      const path = resolve(process.cwd(), name);
      const formatted = await prettier.format(readFileSync(path, 'utf8'), {
        ...(await prettier.resolveConfig(path)),
        filepath: path,
      });
      console.log(`TUX_FMT_${i}_START${Buffer.from(formatted).toString('base64')}TUX_FMT_${i}_END`);
    }
  });
});

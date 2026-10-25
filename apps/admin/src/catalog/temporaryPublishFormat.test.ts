import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as prettier from 'prettier';
import { describe, it } from 'vitest';

describe('temporary publish review formatting output', () => {
  it('prints exact formatted PublishReviewPage output', async () => {
    const path = resolve(process.cwd(), 'apps/admin/src/catalog/PublishReviewPage.tsx');
    const formatted = await prettier.format(readFileSync(path, 'utf8'), {
      ...(await prettier.resolveConfig(path)),
      filepath: path,
    });
    console.log('TUX_REVIEW_FORMAT_START' + Buffer.from(formatted).toString('base64') + 'TUX_REVIEW_FORMAT_END');
  });
});

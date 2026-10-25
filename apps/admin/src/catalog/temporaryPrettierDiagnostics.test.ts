import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as prettier from 'prettier';
import { describe, it } from 'vitest';

describe('temporary Prettier output diagnostics', () => {
  it('prints exact E2E formatting for the CI-only repair', async () => {
    const filePath = resolve(process.cwd(), 'e2e/operations-sync-delivery.e2e.ts');
    const formatted = await prettier.format(readFileSync(filePath, 'utf8'), {
      ...(await prettier.resolveConfig(filePath)),
      filepath: filePath,
    });
    console.log('TUX_FORMATTED_START' + Buffer.from(formatted).toString('base64') + 'TUX_FORMATTED_END');
  });
});

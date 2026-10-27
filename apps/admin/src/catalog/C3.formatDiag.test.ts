import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('TEMP C3 exact Prettier locator — remove after normalized', () => {
  it('shows exact mismatch in advanced Catalog browser test', async () => {
    const filePath = fileURLToPath(new URL('../../../../e2e/admin-catalog-publish.spec.ts', import.meta.url));
    const source = readFileSync(filePath, 'utf8');
    const formatted = await format(source, {
      ...(await resolveConfig(filePath)),
      filepath: filePath,
    });
    expect(source).toBe(formatted);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('TEMP Inventory I1 Prettier diagnosis — delete after normalizing source', () => {
  it('prints the exact required browser test formatting', async () => {
    const filePath = fileURLToPath(
      new URL('../../../../e2e/admin-inventory.spec.ts', import.meta.url),
    );
    const source = readFileSync(filePath, 'utf8');
    const formatted = await format(source, {
      ...(await resolveConfig(filePath)),
      filepath: filePath,
    });
    expect(source).toBe(formatted);
  });
});

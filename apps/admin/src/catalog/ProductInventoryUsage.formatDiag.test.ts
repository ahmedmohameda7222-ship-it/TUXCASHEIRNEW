import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('C3 formatting diagnostic — remove once normalized', () => {
  it('shows the exact workspace Prettier rendering for Inventory Usage', async () => {
    const filePath = fileURLToPath(new URL('./ProductInventoryUsage.tsx', import.meta.url));
    const source = readFileSync(filePath, 'utf8');
    const formatted = await format(source, {
      ...(await resolveConfig(filePath)),
      filepath: filePath,
    });
    expect(source).toBe(formatted);
  });
});

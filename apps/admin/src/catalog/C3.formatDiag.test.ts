import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

const paths = [
  './ProductInspector.tsx',
  './useCatalog.ts',
  '../../../../e2e/admin-catalog.spec.ts',
];

describe('TEMP C3 exact-format diagnostics — delete after normalization', () => {
  for (const path of paths) {
    it(`matches Prettier for ${path}`, async () => {
      const filePath = fileURLToPath(new URL(path, import.meta.url));
      const source = readFileSync(filePath, 'utf8');
      const formatted = await format(source, {
        ...(await resolveConfig(filePath)),
        filepath: filePath,
      });
      expect(source).toBe(formatted);
    });
  }
});

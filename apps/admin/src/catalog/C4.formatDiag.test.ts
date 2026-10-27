import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

const paths = [
  './ProductEditor.tsx',
  '../../../../e2e/admin-catalog.spec.ts',
  '../../server/catalog/catalogImageUpload.test.ts',
];

describe('TEMP Catalog C4 Prettier diagnostics — remove after normalization', () => {
  for (const path of paths) {
    it(`matches exact repository Prettier formatting for ${path}`, async () => {
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

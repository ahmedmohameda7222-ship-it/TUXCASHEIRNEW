import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

const paths = [
  '../../api/admin/catalog.ts',
  '../../server/catalog/catalogService.ts',
  './CatalogPage.tsx',
  '../../../../e2e/admin-catalog.spec.ts',
];

describe('TEMP C3 format diagnosis (remove before acceptance)', () => {
  for (const path of paths) {
    it(`shows exact Prettier diff for ${path}`, async () => {
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

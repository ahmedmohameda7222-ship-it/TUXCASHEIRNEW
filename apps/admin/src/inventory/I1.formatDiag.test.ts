import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('TEMP I1 Prettier source diagnosis — delete after normalizing', () => {
  for (const [name, fileUrl] of [
    ['inventory.css', new URL('./inventory.css', import.meta.url)],
    ['admin-inventory.spec.ts', new URL('../../../../e2e/admin-inventory.spec.ts', import.meta.url)],
  ] as const) {
    it(name, async () => {
      const filePath = fileURLToPath(fileUrl);
      const source = readFileSync(filePath, 'utf8');
      const expected = await format(source, {
        ...(await resolveConfig(filePath)),
        filepath: filePath,
      });
      if (expected === source) return;
      let offset = 0;
      while (source[offset] === expected[offset] && offset < Math.min(source.length, expected.length)) {
        offset++;
      }
      const before = Math.max(0, offset - 140);
      const after = offset + 1900;
      throw new Error(
        name + ' DIFF_AT=' + offset +
          '\nSOURCE:\n' + source.slice(before, after) +
          '\nPRETTIER:\n' + expected.slice(before, after),
      );
    });
  }
});

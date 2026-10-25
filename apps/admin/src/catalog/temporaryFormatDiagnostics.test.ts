import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { it } from 'vitest';

it('exports exact formatter output for image product scope tests', async () => {
  const paths = [
    'apps/admin/server/catalog/catalogImageProductScope.test.ts',
    'apps/admin/src/catalog/catalogImageEditor.test.tsx',
  ];
  for (const path of paths) {
    const original = readFileSync(path, 'utf8');
    const config = (await prettier.resolveConfig(path)) ?? {};
    const formatted = await prettier.format(original, { ...config, filepath: path });
    if (formatted === original) continue;
    const encoded = encodeURIComponent(formatted);
    for (let start = 0; start < encoded.length; start += 900) {
      console.log(`TUXFMT|${path}|${start}|${encoded.slice(start, start + 900)}`);
    }
  }
});

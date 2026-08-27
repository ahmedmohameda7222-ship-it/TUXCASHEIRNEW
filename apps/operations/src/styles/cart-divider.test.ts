import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

test('hides the Current Order divider while preserving resize', () => {
  const orders = readFileSync(resolve(stylesDirectory, 'orders.css'), 'utf8');
  const corrections = readFileSync(resolve(stylesDirectory, 'final-pos-corrections.css'), 'utf8');

  expect(orders).toContain('cursor: col-resize;');
  expect(corrections).toContain(
    '.cart-resize-separator::before {\n  display: none;\n}',
  );
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(stylesDirectory, '..', 'app');

test('hides the Current Order divider while preserving resize and keyboard focus', () => {
  const orders = readFileSync(resolve(stylesDirectory, 'orders.css'), 'utf8');
  const corrections = readFileSync(resolve(stylesDirectory, 'final-pos-corrections.css'), 'utf8');

  expect(orders).toContain('cursor: col-resize;');
  expect(orders).toContain('.cart-resize-separator:focus-visible::before {');
  expect(corrections).toContain('.cart-resize-separator::before {\n  display: none;\n}');
  expect(corrections).toContain(
    '.cart-resize-separator:focus-visible::before {\n  display: block;\n}',
  );
});

test('uses a 4px visual gap while preserving the 12px resize hit area', () => {
  const workspace = readFileSync(resolve(appDirectory, 'OrdersWorkspace.tsx'), 'utf8');
  const corrections = readFileSync(resolve(stylesDirectory, 'final-pos-corrections.css'), 'utf8');

  expect(workspace).toContain('gridTemplateColumns: `minmax(0, 1fr) 4px ${cartWidth}px`');
  expect(corrections).toContain('.cart-resize-separator {\n  width: 12px;\n  min-width: 12px;');
});

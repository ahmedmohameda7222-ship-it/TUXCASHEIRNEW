import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Catalog Copy supported-domain disclosure', () => {
  it('describes mapped modifier definitions and compatible recipe lines as supported', () => {
    const panel = readFileSync(new URL('./CatalogCopyPanel.tsx', import.meta.url), 'utf8');

    expect(panel).not.toContain(
      'Missing entities, modifier definitions, recipes, and history are not copied.',
    );
    expect(panel).toContain('Mapped modifier definitions and compatible recipe lines can be copied.');
    expect(panel).toContain('Missing target categories or products are not yet copied.');
    expect(panel).toContain('Historical sales and inventory balances are never copied.');
  });
});

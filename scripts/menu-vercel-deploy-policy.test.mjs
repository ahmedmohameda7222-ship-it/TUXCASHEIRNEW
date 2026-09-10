import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  readFileSync(resolve(repoRoot, 'apps/menu/vercel.json'), 'utf8'),
);

describe('Menu Vercel Git deployment policy', () => {
  it('allows Git deployments from main and disables every other branch', () => {
    expect(config.git?.deploymentEnabled).toEqual({
      '*': false,
      main: true,
    });
  });
});

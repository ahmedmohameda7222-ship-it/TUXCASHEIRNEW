import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(appDirectory, '../../../..');
const migrationPath = resolve(
  repositoryRoot,
  'supabase/migrations/20260827010000_tux_menu_product_descriptions.sql',
);

const approvedDescriptions = new Map<string, string>([
  ['Single Smashed Patty', '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'],
  ['Double Smashed Patty', '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'],
  ['Triple Smashed Patty', '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'],
  [
    'TUX Quatro Smashed Patty',
    '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom',
  ],
  [
    'Single TUXIFY',
    'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
  ],
  [
    'Double TUXIFY',
    'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
  ],
  [
    'Triple TUXIFY',
    'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
  ],
  [
    'Quatro TUXIFY',
    'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
  ],
  ['Chili Fries', 'Fries, cheese, chili sauce, jalapeno'],
  [
    'TUX Fries',
    'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce',
  ],
  [
    'Doppy Fries',
    'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion',
  ],
  [
    'Johnny’s',
    '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges',
  ],
  ['Classic Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce'],
  [
    'TUX Hawawshi',
    'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella',
  ],
]);

describe('TUX product description data contract', () => {
  it('keeps the approved descriptions in a versioned Supabase migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, 'utf8');
    for (const [name, description] of approvedDescriptions) {
      expect(migration).toContain(name);
      expect(migration).toContain(description);
    }

    expect(migration).toMatch(/update\s+public\.products/iu);
    expect(migration).toContain('operations_configuration_snapshots');
    expect(migration).toMatch(/version\s*\+\s*1/iu);
    expect(migration).toContain('bundle_json');
    expect(migration).toContain("'{snapshot,products}'");
    expect(migration).toContain("'{snapshot,version}'");
    expect(migration).toContain("'{snapshot,updatedAt}'");
  });

  it('keeps Quick Info data-driven instead of hardcoding menu descriptions in React', () => {
    const workspace = readFileSync(resolve(appDirectory, 'OrdersWorkspace.tsx'), 'utf8');

    expect(workspace).toContain(
      "product.description?.trim() || 'No product description has been added yet.'",
    );
    for (const [name, description] of approvedDescriptions) {
      expect(workspace).not.toContain(name);
      expect(workspace).not.toContain(description);
    }
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

describe('Admin Round 2 presentation sanitization', () => {
  it('uses friendly role and inventory labels instead of raw enums', () => {
    expect(read('components/shell/AdminTopBar.tsx')).not.toContain('{principal.role}');
    expect(read('inventory/InventoryPage.tsx')).not.toContain(
      "item.trackingMode.replaceAll('_', ' ')",
    );
  });

  it('keeps engineering authority vocabulary out of normal task copy', () => {
    expect(read('catalog/PublishReviewPage.tsx')).not.toContain('canonical catalog');
    expect(read('catalog/CatalogPage.tsx')).not.toContain('concrete shop');
    expect(read('settings/SettingsPage.tsx')).not.toContain('concrete shop scope');
    expect(read('catalog/ProductEditor.tsx')).not.toContain(
      'Published versions are immutable. Restore creates a new version.',
    );
  });

  it('uses an explicit friendly loyalty-event metadata layer', () => {
    const loyalty = read('customers/LoyaltyPanel.tsx');
    expect(loyalty).toContain('loyaltyEventLabel');
    expect(loyalty).not.toContain(
      "event.eventType\n                  .toLowerCase()\n                  .replaceAll('_', ' ')",
    );
  });
});

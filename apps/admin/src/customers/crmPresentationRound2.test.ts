import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const customerDirectory = dirname(fileURLToPath(import.meta.url));
const promotionDirectory = join(customerDirectory, '../promotions');
const read = (directory: string, file: string) => readFileSync(join(directory, file), 'utf8');

describe('CRM Round 2 presentation', () => {
  it('keeps CRM settings route-addressable and provides the complete customer IA', () => {
    const page = read(customerDirectory, 'CustomersPage.tsx');
    const detail = read(customerDirectory, 'CustomerDetailPage.tsx');

    expect(page).toContain("location === '/customers/settings'");
    expect(page).toContain("? '/customers/settings' : '/customers'");
    for (const label of ['Overview', 'Orders', 'Addresses', 'Loyalty', 'History']) {
      expect(detail).toContain(`label: '${label}'`);
    }
  });

  it('shows loyalty value in EGP and uses configured reasons', () => {
    const loyalty = read(customerDirectory, 'LoyaltyPanel.tsx');

    expect(loyalty).not.toContain('minor / point');
    expect(loyalty).toContain('1 point = EGP');
    expect(loyalty).toContain('reasons.map');
    expect(loyalty).not.toContain('<span>Reason code</span>');
  });

  it('uses named promotion choices and business units', () => {
    const editor = read(promotionDirectory, 'PromotionEditor.tsx');

    expect(editor).toContain('Percentage discount');
    expect(editor).toContain('Fixed amount discount');
    expect(editor).toContain('Free item');
    expect(editor).toContain('products.map');
    expect(editor).toContain('categories.map');
    expect(editor).not.toMatch(/basis points|minor units|Free product ID|comma-separated/i);
  });
});

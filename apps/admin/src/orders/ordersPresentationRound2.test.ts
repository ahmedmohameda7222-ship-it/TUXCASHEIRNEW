import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(directory, file), 'utf8');

describe('orders Round 2 presentation', () => {
  it('keeps internal revisions, reason versions, raw micros, and nested h1 out of order detail', () => {
    const detail = read('OrderDetailPage.tsx');

    expect(detail).not.toContain('<h1');
    expect(detail).not.toContain('operationalRevision');
    expect(detail).not.toContain('configurationVersion');
    expect(detail).not.toContain('quantityDeltaMicros}');
    expect(detail).not.toContain('reservedDeltaMicros}');
  });

  it('offers refund and return as separate focused modes', () => {
    const page = read('OrdersPage.tsx');
    const sheet = read('RefundReturnPage.tsx');

    expect(page).toContain("type ActionMode = 'cancel' | 'refund' | 'return' | null");
    expect(page).not.toContain("'refund-return'");
    expect(sheet).toContain("mode: 'refund' | 'return'");
    expect(sheet).not.toContain('title="Refund or return"');
  });

  it('uses a compact mobile filter disclosure and friendly list labels', () => {
    const page = read('OrdersPage.tsx');

    expect(page).toContain('<details className="admin-orders-filters"');
    expect(page).toContain('orderStatusLabel');
    expect(page).toContain('orderSourceLabel');
  });
});

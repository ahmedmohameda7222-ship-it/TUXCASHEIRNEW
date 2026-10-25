import type { CatalogPublishEntityChange } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PublishReviewChanges } from './PublishReviewChanges';

const changes: CatalogPublishEntityChange[] = [
  {
    kind: 'product',
    id: 'product-1',
    status: 'modified',
    before: { name: 'Burger', priceMinor: 1000 },
    after: { name: 'Burger Deluxe', priceMinor: 1400 },
    changedFields: ['name', 'priceMinor'],
  },
  {
    kind: 'category',
    id: 'category-1',
    status: 'unchanged',
    before: { name: 'Burgers' },
    after: { name: 'Burgers' },
    changedFields: [],
  },
];

describe('publish review details', () => {
  it('shows changed before-after field values and unchanged entities', () => {
    const html = renderToStaticMarkup(<PublishReviewChanges changes={changes} />);
    expect(html).toContain('Before → After review');
    expect(html).toContain('Burger Deluxe');
    expect(html).toContain('Burger');
    expect(html).toContain('EGP 10.00');
    expect(html).toContain('EGP 14.00');
    expect(html).toContain('1 unchanged records');
    expect(html).toContain('No change takes effect until');
  });
});

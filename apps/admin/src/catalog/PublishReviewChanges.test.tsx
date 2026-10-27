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
  it('C5 describes image additions, replacements and removals without leaking storage keys', () => {
    const cases = [
      { before: null, after: 'private/shop-a/images/added.png', expected: 'Photo added' },
      {
        before: 'private/shop-a/images/old.png',
        after: 'private/shop-a/images/new.png',
        expected: 'Photo replaced',
      },
      { before: 'private/shop-a/images/old.png', after: null, expected: 'Photo removed' },
    ];
    for (const { before, after, expected } of cases) {
      const imageChange: CatalogPublishEntityChange = {
        kind: 'product',
        id: 'product-1',
        status: 'modified',
        before: { name: 'Classic Smash', imageKey: before },
        after: { name: 'Classic Smash', imageKey: after },
        changedFields: ['imageKey'],
      };
      const markup = renderToStaticMarkup(<PublishReviewChanges changes={[imageChange]} />);
      expect(markup).toContain('Classic Smash');
      expect(markup).toContain('Product image');
      expect(markup).toContain(expected);
      expect(markup).not.toContain('private/shop-a/images/');
    }
  });

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

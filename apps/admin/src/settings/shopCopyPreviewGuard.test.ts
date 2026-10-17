import { describe, expect, it } from 'vitest';

import {
  shopCopyPreviewMatchesSelection,
  type ShopCopyPreviewContext,
} from './shopCopyPreviewGuard';

const context: ShopCopyPreviewContext = {
  sourceShopId: 'source-shop',
  targetShopId: 'target-shop',
  targetSettingsVersion: 7,
  selectedDomains: ['checkout', 'receipts'],
};
const preview: ShopCopyPreviewContext = { ...context };

describe('selective settings copy preview binding', () => {
  it('accepts the exact selected source, target, version and domains', () => {
    expect(shopCopyPreviewMatchesSelection(preview, context)).toBe(true);
    expect(shopCopyPreviewMatchesSelection(null, context)).toBe(false);
  });

  it.each([
    { sourceShopId: 'unauthorized-source' },
    { targetShopId: 'another-target' },
    { targetSettingsVersion: 8 },
    { selectedDomains: ['receipts', 'checkout'] },
    { selectedDomains: ['checkout'] },
    { selectedDomains: [] },
    { sourceShopId: 'target-shop' },
  ])('invalidates a stale or mismatched copy preview %j', (changes) => {
    expect(shopCopyPreviewMatchesSelection(preview, { ...context, ...changes })).toBe(false);
  });
});

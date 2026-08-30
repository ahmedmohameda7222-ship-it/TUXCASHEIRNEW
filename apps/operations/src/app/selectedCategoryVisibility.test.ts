import { describe, expect, it } from 'vitest';
import { shouldEnsureSelectedCategoryVisible } from './selectedCategoryVisibility';

describe('shouldEnsureSelectedCategoryVisible', () => {
  const rail = { left: 100, right: 300 };

  it('does not request scrolling when the selected tab is fully visible', () => {
    expect(shouldEnsureSelectedCategoryVisible(rail, { left: 100, right: 160 })).toBe(false);
    expect(shouldEnsureSelectedCategoryVisible(rail, { left: 220, right: 300 })).toBe(false);
  });

  it('requests scrolling when the selected tab is clipped on the left', () => {
    expect(shouldEnsureSelectedCategoryVisible(rail, { left: 80, right: 140 })).toBe(true);
  });

  it('requests scrolling when the selected tab is clipped on the right', () => {
    expect(shouldEnsureSelectedCategoryVisible(rail, { left: 270, right: 330 })).toBe(true);
  });
});

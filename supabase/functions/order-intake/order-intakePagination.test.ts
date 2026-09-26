import { describe, expect, it, vi } from 'vitest';

import { collectAllPages } from './pagedSelect';

describe('order-intake PostgREST pagination', () => {
  it('collects catalog rows across every page instead of truncating at the first row cap', async () => {
    const fetchPage = vi.fn(async (from: number, to: number) => {
      const pages = new Map<number, readonly string[]>([
        [0, ['a', 'b']],
        [2, ['c', 'd']],
        [4, ['e']],
      ]);
      expect(to - from + 1).toBe(2);
      return pages.get(from) ?? [];
    });

    await expect(collectAllPages(fetchPage, 2)).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage.mock.calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

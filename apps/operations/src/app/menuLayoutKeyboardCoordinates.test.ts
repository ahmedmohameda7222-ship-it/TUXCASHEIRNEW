import { describe, expect, it } from 'vitest';
import { menuLayoutSortableKind } from './menuLayoutKeyboardCoordinates';

describe('menu layout keyboard sortable kind', () => {
  it('keeps category and product keyboard targets in separate sortable groups', () => {
    expect(menuLayoutSortableKind('category:30000000-0000-4000-8000-000000000001')).toBe(
      'CATEGORY',
    );
    expect(menuLayoutSortableKind('product:40000000-0000-4000-8000-000000000001')).toBe(
      'PRODUCT',
    );
    expect(menuLayoutSortableKind('unrelated')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { menuLayoutSortableKind } from './menuLayoutKeyboardCoordinates';

const categorySortableId = 'category:30000000-0000-4000-8000-000000000001';
const productSortableId = 'product:40000000-0000-4000-8000-000000000001';

describe('menu layout keyboard sortable kind', () => {
  it('keeps category and product keyboard targets in separate sortable groups', () => {
    expect(menuLayoutSortableKind(categorySortableId)).toBe('CATEGORY');
    expect(menuLayoutSortableKind(productSortableId)).toBe('PRODUCT');
    expect(menuLayoutSortableKind('unrelated')).toBeNull();
  });
});

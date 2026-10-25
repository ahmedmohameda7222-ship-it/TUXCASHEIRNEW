import { describe, expect, it } from 'vitest';

import { adminReturnLineItemsSchema } from '../../api/admin/orders';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

describe('Admin return line input validation', () => {
  it('rejects repeated item IDs before a financial mutation or database uniqueness failure', () => {
    const result = adminReturnLineItemsSchema.safeParse([
      { orderItemId: first, quantity: 1 },
      { orderItemId: first, quantity: 2 },
    ]);
    expect(result.success).toBe(false);
  });

  it('accepts distinct positive safe integer quantities only', () => {
    expect(adminReturnLineItemsSchema.safeParse([
      { orderItemId: first, quantity: 1 },
      { orderItemId: second, quantity: 2 },
    ]).success).toBe(true);
    expect(adminReturnLineItemsSchema.safeParse([
      { orderItemId: first, quantity: 0 },
    ]).success).toBe(false);
    expect(adminReturnLineItemsSchema.safeParse([
      { orderItemId: first, quantity: Number.MAX_SAFE_INTEGER + 1 },
    ]).success).toBe(false);
  });
});

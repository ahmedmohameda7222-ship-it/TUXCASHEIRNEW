import { describe, expect, it } from 'vitest';

import { classifyOrderReadInputError } from '../../api/admin/orders';

describe('Orders query input errors', () => {
  it('returns actionable HTTP 400 for malformed cursor and date filters', () => {
    expect(classifyOrderReadInputError(new Error('invalid_order_cursor'))).toEqual({
      status: 400,
      error: 'invalid_order_cursor',
    });
    expect(classifyOrderReadInputError(new Error('invalid_orders_date_filter'))).toEqual({
      status: 400,
      error: 'invalid_orders_date_filter',
    });
  });

  it('does not leak unknown failures as validation errors', () => {
    expect(classifyOrderReadInputError(new Error('database_failure'))).toBeNull();
  });
});

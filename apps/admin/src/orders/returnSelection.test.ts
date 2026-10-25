import { describe, expect, it } from 'vitest';

import { buildReturnItemSelection } from './RefundReturnPage';

const items = [
  { id: 'item-one', remainingReturnableQuantity: 2 },
  { id: 'item-two', remainingReturnableQuantity: 1 },
];

describe('Orders return form input integrity', () => {
  it('never silently omits an invalid selected item when another selection is valid', () => {
    expect(buildReturnItemSelection(items, { 'item-one': '2', 'item-two': '3' })).toEqual({
      items: [],
      hasInvalidQuantity: true,
    });
  });

  it('rejects fractional, negative, unsafe or nonnumeric return quantities', () => {
    for (const value of ['0.5', '-1', 'abc', '9007199254740992']) {
      expect(buildReturnItemSelection(items, { 'item-one': value }).hasInvalidQuantity).toBe(true);
    }
  });

  it('accepts valid partial quantities without double-counting originals', () => {
    expect(buildReturnItemSelection(items, { 'item-one': '1', 'item-two': '1' })).toEqual({
      items: [
        { orderItemId: 'item-one', quantity: 1 },
        { orderItemId: 'item-two', quantity: 1 },
      ],
      hasInvalidQuantity: false,
    });
  });
});

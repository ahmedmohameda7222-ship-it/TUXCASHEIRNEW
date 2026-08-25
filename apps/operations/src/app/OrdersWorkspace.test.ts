import {
  instant,
  parseEntityId,
  type MenuCategory,
  type MenuCategoryId,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import { describe, expect, it } from 'vitest';
import { reconcileCategoryOrder } from './OrdersWorkspace';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');

function category(index: number, name: string): MenuCategory {
  return {
    id: parseEntityId<MenuCategoryId>(`33333333-3333-4333-8333-${String(index).padStart(12, '0')}`),
    shopId,
    name,
    sortOrder: index - 1,
    active: true,
  };
}

const burgers = category(1, 'Burgers');
const sides = category(2, 'Sides');
const drinks = category(3, 'Drinks');

function preference(categoryOrder: readonly MenuCategoryId[]): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: 'right',
    serverVersion: 4,
    updatedAt: instant(new Date('2026-08-25T04:00:00.000Z')),
    syncState: 'CLEAN',
  };
}

describe('reconcileCategoryOrder', () => {
  it('keeps saved active categories first and appends newly active configuration categories', () => {
    const staleId = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-999999999999');

    expect(
      reconcileCategoryOrder(
        [burgers, sides, drinks],
        preference([drinks.id, staleId, burgers.id]),
      ).map((item) => item.name),
    ).toEqual(['Drinks', 'Burgers', 'Sides']);
  });

  it('uses configuration order when the worker has no saved preference', () => {
    expect(reconcileCategoryOrder([burgers, sides, drinks], null)).toEqual([
      burgers,
      sides,
      drinks,
    ]);
  });
});

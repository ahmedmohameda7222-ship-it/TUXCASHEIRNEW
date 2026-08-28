import {
  instant,
  parseEntityId,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import { describe, expect, it } from 'vitest';
import * as editing from './workerUiPreferenceEditing';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const categoryA = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-000000000001');
const categoryB = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-000000000002');
const productA = parseEntityId<ProductId>('44444444-4444-4444-8444-000000000001');
const productB = parseEntityId<ProductId>('44444444-4444-4444-8444-000000000002');

const preference: WorkerUiPreferences = {
  shopId,
  workerId,
  categoryOrder: [categoryB, categoryA],
  categoryAlignment: 'right',
  productOrder: [productB, productA],
  serverVersion: 4,
  updatedAt: instant(new Date('2026-08-28T06:00:00.000Z')),
  syncState: 'CLEAN',
};

describe('worker UI preference editing', () => {
  it('preserves product order while saving or resetting category layout', () => {
    expect('categoryLayoutPreferenceInput' in editing).toBe(true);
    if (!('categoryLayoutPreferenceInput' in editing)) return;

    expect(
      editing.categoryLayoutPreferenceInput(preference, [categoryA, categoryB], 'center', false),
    ).toEqual({
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'center',
      productOrder: [productB, productA],
    });
    expect(
      editing.categoryLayoutPreferenceInput(preference, [categoryA, categoryB], 'center', true),
    ).toEqual({
      categoryOrder: [],
      categoryAlignment: 'left',
      productOrder: [productB, productA],
    });
  });

  it('preserves category layout while saving or resetting product positions', () => {
    expect('productOrderPreferenceInput' in editing).toBe(true);
    if (!('productOrderPreferenceInput' in editing)) return;

    expect(editing.productOrderPreferenceInput(preference, [productA, productB], false)).toEqual({
      categoryOrder: [categoryB, categoryA],
      categoryAlignment: 'right',
      productOrder: [productA, productB],
    });
    expect(editing.productOrderPreferenceInput(preference, [productA, productB], true)).toEqual({
      categoryOrder: [categoryB, categoryA],
      categoryAlignment: 'right',
      productOrder: [],
    });
  });
});

import type {
  CategoryAlignment,
  MenuCategoryId,
  ProductId,
  WorkerUiPreferences,
} from '@tux/domain';

export interface WorkerMenuLayoutUpdateInput {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}

export function categoryLayoutPreferenceInput(
  preference: WorkerUiPreferences | null,
  categoryOrder: readonly MenuCategoryId[],
  categoryAlignment: CategoryAlignment,
  reset: boolean,
): WorkerMenuLayoutUpdateInput {
  return {
    categoryOrder: reset ? [] : categoryOrder,
    categoryAlignment: reset ? 'left' : categoryAlignment,
    productOrder: preference?.productOrder ?? [],
  };
}

export function productOrderPreferenceInput(
  preference: WorkerUiPreferences | null,
  productOrder: readonly ProductId[],
  reset: boolean,
): WorkerMenuLayoutUpdateInput {
  return {
    categoryOrder: preference?.categoryOrder ?? [],
    categoryAlignment: preference?.categoryAlignment ?? 'left',
    productOrder: reset ? [] : productOrder,
  };
}

export function menuEditPreferenceInput(
  categoryOrder: readonly MenuCategoryId[],
  categoryAlignment: CategoryAlignment,
  productOrder: readonly ProductId[],
  reset: boolean,
): WorkerMenuLayoutUpdateInput {
  return reset
    ? {
        categoryOrder: [],
        categoryAlignment: 'left',
        productOrder: [],
      }
    : {
        categoryOrder,
        categoryAlignment,
        productOrder,
      };
}

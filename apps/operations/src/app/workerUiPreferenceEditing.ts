import type {
  CategoryAlignment,
  MenuCategoryId,
  ProductId,
  WorkerUiPreferences,
} from '@tux/domain';

export interface WorkerUiPreferenceUpdateInput {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}

export function categoryLayoutPreferenceInput(
  preference: WorkerUiPreferences | null,
  categoryOrder: readonly MenuCategoryId[],
  categoryAlignment: CategoryAlignment,
  reset: boolean,
): WorkerUiPreferenceUpdateInput {
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
): WorkerUiPreferenceUpdateInput {
  return {
    categoryOrder: preference?.categoryOrder ?? [],
    categoryAlignment: preference?.categoryAlignment ?? 'left',
    productOrder: reset ? [] : productOrder,
  };
}

import type {
  CategoryAlignment,
  MenuCategoryId,
  ProductId,
  ShopId,
  WorkerId,
} from '@tux/domain';

export type MenuLayoutEditorLifecycle =
  'CLOSED' | 'EDITING' | 'SAVING' | 'ERROR';

export interface MenuLayoutDraft {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}

export type MenuLayoutEditorInteraction =
  | { readonly type: 'NONE' }
  | {
      readonly type: 'CATEGORY_PICKUP';
      readonly categoryId: MenuCategoryId;
      readonly snapshot: MenuLayoutDraft;
    }
  | {
      readonly type: 'PRODUCT_PICKUP';
      readonly productId: ProductId;
      readonly categoryId: MenuCategoryId;
      readonly snapshot: MenuLayoutDraft;
    };

export interface MenuLayoutEditorSession {
  readonly lifecycle: MenuLayoutEditorLifecycle;
  readonly openingShopId: ShopId | null;
  readonly openingWorkerId: WorkerId | null;
  readonly base: MenuLayoutDraft | null;
  readonly draft: MenuLayoutDraft | null;
  readonly interaction: MenuLayoutEditorInteraction;
  readonly dirty: boolean;
  readonly resetRequested: boolean;
  readonly saveError: string | null;
  readonly saveToken: string | null;
}

export type MenuLayoutEditorEvent =
  | {
      readonly type: 'OPEN';
      readonly shopId: ShopId;
      readonly workerId: WorkerId;
      readonly base: MenuLayoutDraft;
    }
  | {
      readonly type: 'SET_CATEGORY_ORDER';
      readonly categoryOrder: readonly MenuCategoryId[];
    }
  | {
      readonly type: 'SET_ALIGNMENT';
      readonly categoryAlignment: CategoryAlignment;
    }
  | {
      readonly type: 'SET_PRODUCT_ORDER';
      readonly productOrder: readonly ProductId[];
    }
  | {
      readonly type: 'BEGIN_CATEGORY_PICKUP';
      readonly categoryId: MenuCategoryId;
    }
  | {
      readonly type: 'BEGIN_PRODUCT_PICKUP';
      readonly productId: ProductId;
      readonly categoryId: MenuCategoryId;
    }
  | {
      readonly type: 'DROP_CATEGORY_PICKUP';
      readonly categoryId: MenuCategoryId;
    }
  | { readonly type: 'DROP_PRODUCT_PICKUP'; readonly productId: ProductId }
  | { readonly type: 'CANCEL_PICKUP' }
  | { readonly type: 'CATEGORY_CHANGE' }
  | { readonly type: 'RESET'; readonly draft: MenuLayoutDraft }
  | { readonly type: 'CANCEL_EDITOR' }
  | { readonly type: 'BEGIN_SAVE'; readonly saveToken: string }
  | {
      readonly type: 'SAVE_SUCCESS';
      readonly shopId: ShopId;
      readonly workerId: WorkerId;
      readonly saveToken: string;
    }
  | {
      readonly type: 'SAVE_FAILURE';
      readonly shopId: ShopId;
      readonly workerId: WorkerId;
      readonly saveToken: string;
      readonly message: string;
    }
  | {
      readonly type: 'IDENTITY_INVALIDATED';
      readonly shopId: ShopId;
      readonly workerId: WorkerId;
    };

export interface OpenMenuLayoutEditorInput {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly base: MenuLayoutDraft;
}

function cloneDraft(draft: MenuLayoutDraft): MenuLayoutDraft {
  return {
    categoryOrder: [...draft.categoryOrder],
    categoryAlignment: draft.categoryAlignment,
    productOrder: [...draft.productOrder],
  };
}

function sameOrder<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function menuLayoutDraftsEqual(
  left: MenuLayoutDraft | null,
  right: MenuLayoutDraft | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.categoryAlignment === right.categoryAlignment &&
    sameOrder(left.categoryOrder, right.categoryOrder) &&
    sameOrder(left.productOrder, right.productOrder)
  );
}

export function createClosedMenuLayoutEditorSession(): MenuLayoutEditorSession {
  return {
    lifecycle: 'CLOSED',
    openingShopId: null,
    openingWorkerId: null,
    base: null,
    draft: null,
    interaction: { type: 'NONE' },
    dirty: false,
    resetRequested: false,
    saveError: null,
    saveToken: null,
  };
}

export function openMenuLayoutEditorSession(
  state: MenuLayoutEditorSession,
  input: OpenMenuLayoutEditorInput,
): MenuLayoutEditorSession {
  if (state.lifecycle !== 'CLOSED') return state;
  const base = cloneDraft(input.base);
  return {
    lifecycle: 'EDITING',
    openingShopId: input.shopId,
    openingWorkerId: input.workerId,
    base,
    draft: cloneDraft(base),
    interaction: { type: 'NONE' },
    dirty: false,
    resetRequested: false,
    saveError: null,
    saveToken: null,
  };
}

function withDraft(
  state: MenuLayoutEditorSession,
  draft: MenuLayoutDraft,
  options: { readonly resetRequested?: boolean } = {},
): MenuLayoutEditorSession {
  if (state.base === null) return state;
  const nextDraft = cloneDraft(draft);
  return {
    ...state,
    lifecycle: state.lifecycle === 'ERROR' ? 'EDITING' : state.lifecycle,
    draft: nextDraft,
    dirty: !menuLayoutDraftsEqual(state.base, nextDraft),
    resetRequested: options.resetRequested ?? false,
    saveError: null,
  };
}

function rollbackPickup(
  state: MenuLayoutEditorSession,
): MenuLayoutEditorSession {
  if (state.interaction.type === 'NONE') return state;
  if (state.base === null) return state;
  const draft = cloneDraft(state.interaction.snapshot);
  return {
    ...state,
    draft,
    interaction: { type: 'NONE' },
    dirty: !menuLayoutDraftsEqual(state.base, draft),
  };
}

function canMutateDraft(state: MenuLayoutEditorSession): boolean {
  return (
    (state.lifecycle === 'EDITING' || state.lifecycle === 'ERROR') &&
    state.base !== null &&
    state.draft !== null
  );
}

function saveCompletionMatches(
  state: MenuLayoutEditorSession,
  event: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly saveToken: string;
  },
): boolean {
  return (
    state.lifecycle === 'SAVING' &&
    state.openingShopId === event.shopId &&
    state.openingWorkerId === event.workerId &&
    state.saveToken === event.saveToken
  );
}

export function menuLayoutEditorReducer(
  state: MenuLayoutEditorSession,
  event: MenuLayoutEditorEvent,
): MenuLayoutEditorSession {
  if (event.type === 'IDENTITY_INVALIDATED') {
    if (state.lifecycle === 'CLOSED') return state;
    if (
      state.openingShopId === event.shopId &&
      state.openingWorkerId === event.workerId
    ) {
      return state;
    }
    return createClosedMenuLayoutEditorSession();
  }

  if (event.type === 'SAVE_SUCCESS') {
    if (!saveCompletionMatches(state, event)) return state;
    return createClosedMenuLayoutEditorSession();
  }

  if (event.type === 'SAVE_FAILURE') {
    if (!saveCompletionMatches(state, event)) return state;
    return {
      ...state,
      lifecycle: 'ERROR',
      saveError: event.message,
      saveToken: null,
    };
  }

  if (state.lifecycle === 'SAVING') return state;

  switch (event.type) {
    case 'OPEN':
      return openMenuLayoutEditorSession(state, event);

    case 'SET_CATEGORY_ORDER':
      if (!canMutateDraft(state) || state.draft === null) return state;
      return withDraft(state, {
        ...state.draft,
        categoryOrder: [...event.categoryOrder],
      });

    case 'SET_ALIGNMENT':
      if (!canMutateDraft(state) || state.draft === null) return state;
      return withDraft(state, {
        ...state.draft,
        categoryAlignment: event.categoryAlignment,
      });

    case 'SET_PRODUCT_ORDER':
      if (!canMutateDraft(state) || state.draft === null) return state;
      return withDraft(state, {
        ...state.draft,
        productOrder: [...event.productOrder],
      });

    case 'BEGIN_CATEGORY_PICKUP': {
      if (!canMutateDraft(state)) return state;
      const resolved = rollbackPickup(state);
      if (resolved.draft === null) return state;
      return {
        ...resolved,
        interaction: {
          type: 'CATEGORY_PICKUP',
          categoryId: event.categoryId,
          snapshot: cloneDraft(resolved.draft),
        },
      };
    }

    case 'BEGIN_PRODUCT_PICKUP': {
      if (!canMutateDraft(state)) return state;
      const resolved = rollbackPickup(state);
      if (resolved.draft === null) return state;
      return {
        ...resolved,
        interaction: {
          type: 'PRODUCT_PICKUP',
          productId: event.productId,
          categoryId: event.categoryId,
          snapshot: cloneDraft(resolved.draft),
        },
      };
    }

    case 'DROP_CATEGORY_PICKUP':
      if (
        state.interaction.type !== 'CATEGORY_PICKUP' ||
        state.interaction.categoryId !== event.categoryId
      ) {
        return state;
      }
      return { ...state, interaction: { type: 'NONE' } };

    case 'DROP_PRODUCT_PICKUP':
      if (
        state.interaction.type !== 'PRODUCT_PICKUP' ||
        state.interaction.productId !== event.productId
      ) {
        return state;
      }
      return { ...state, interaction: { type: 'NONE' } };

    case 'CANCEL_PICKUP':
    case 'CATEGORY_CHANGE':
      return rollbackPickup(state);

    case 'RESET': {
      if (!canMutateDraft(state)) return state;
      const reset = withDraft(rollbackPickup(state), event.draft, {
        resetRequested: true,
      });
      return { ...reset, interaction: { type: 'NONE' } };
    }

    case 'CANCEL_EDITOR':
      if (state.lifecycle === 'CLOSED') return state;
      return createClosedMenuLayoutEditorSession();

    case 'BEGIN_SAVE': {
      if (!canMutateDraft(state)) return state;
      const resolved = rollbackPickup(state);
      return {
        ...resolved,
        lifecycle: 'SAVING',
        interaction: { type: 'NONE' },
        saveError: null,
        saveToken: event.saveToken,
      };
    }
  }
}

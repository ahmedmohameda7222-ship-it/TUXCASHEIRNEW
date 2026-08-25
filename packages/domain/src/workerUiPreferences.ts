import { parseEntityId, type MenuCategoryId, type ShopId, type WorkerId } from './ids';
import { instant, type Instant } from './time';

export type CategoryAlignment = 'left' | 'center' | 'right';
export type WorkerUiPreferencesSyncState = 'CLEAN' | 'DIRTY';

export interface WorkerUiPreferences {
  readonly shopId: ShopId;
  readonly workerId: WorkerId;
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly updatedAt: Instant;
  readonly serverVersion: number;
  readonly syncState: WorkerUiPreferencesSyncState;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('WorkerUiPreferences must be an object.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`WorkerUiPreferences.${field} must be a non-empty string.`);
  }
  return value;
}

function categoryAlignment(value: unknown): CategoryAlignment {
  if (value !== 'left' && value !== 'center' && value !== 'right') {
    throw new TypeError('WorkerUiPreferences.categoryAlignment is invalid.');
  }
  return value;
}

function syncState(value: unknown): WorkerUiPreferencesSyncState {
  if (value !== 'CLEAN' && value !== 'DIRTY') {
    throw new TypeError('WorkerUiPreferences.syncState is invalid.');
  }
  return value;
}

function categoryOrder(value: unknown): readonly MenuCategoryId[] {
  if (!Array.isArray(value)) {
    throw new TypeError('WorkerUiPreferences.categoryOrder must be an array.');
  }
  const parsed = value.map((categoryId, index) => {
    try {
      return parseEntityId<MenuCategoryId>(text(categoryId, `categoryOrder[${index}]`));
    } catch (cause) {
      throw new TypeError(`WorkerUiPreferences.categoryOrder[${index}] is invalid.`, { cause });
    }
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError(
      'WorkerUiPreferences.categoryOrder must not contain duplicate category IDs.',
    );
  }
  return parsed;
}

export function parseWorkerUiPreferences(value: unknown): WorkerUiPreferences {
  const preferences = record(value);
  const serverVersion = preferences['serverVersion'];
  if (
    typeof serverVersion !== 'number' ||
    !Number.isSafeInteger(serverVersion) ||
    serverVersion < 0
  ) {
    throw new TypeError('WorkerUiPreferences.serverVersion must be a non-negative safe integer.');
  }

  try {
    return {
      shopId: parseEntityId<ShopId>(text(preferences['shopId'], 'shopId')),
      workerId: parseEntityId<WorkerId>(text(preferences['workerId'], 'workerId')),
      categoryOrder: categoryOrder(preferences['categoryOrder']),
      categoryAlignment: categoryAlignment(preferences['categoryAlignment']),
      updatedAt: instant(text(preferences['updatedAt'], 'updatedAt')),
      serverVersion,
      syncState: syncState(preferences['syncState']),
    };
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith('WorkerUiPreferences.')) throw cause;
    throw new TypeError('WorkerUiPreferences is invalid.', { cause });
  }
}

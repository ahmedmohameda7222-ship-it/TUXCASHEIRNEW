import type { ShopId, WorkerId, WorkerUiPreferences } from '@tux/domain';

export interface WorkerUiPreferencesRepository {
  get(shopId: ShopId, workerId: WorkerId): Promise<WorkerUiPreferences | null>;
  put(preferences: WorkerUiPreferences): Promise<void>;
  delete(shopId: ShopId, workerId: WorkerId): Promise<void>;
}

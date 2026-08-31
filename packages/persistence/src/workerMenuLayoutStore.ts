import type { ShopId, WorkerId, WorkerMenuLayout } from '@tux/domain';

export interface WorkerMenuLayoutRepository {
  get(shopId: ShopId, workerId: WorkerId): Promise<WorkerMenuLayout | null>;
  put(layout: WorkerMenuLayout): Promise<void>;
  delete(shopId: ShopId, workerId: WorkerId): Promise<void>;
}

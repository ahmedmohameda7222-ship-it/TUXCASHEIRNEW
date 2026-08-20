import type { BusinessDayId, Shop, ShopId, Worker, WorkerSession } from '@tux/domain';

export interface OperatorSessionReadModel {
  listActiveShops(): Promise<readonly Shop[]>;
  listActiveWorkers(shopId: ShopId): Promise<readonly Worker[]>;
  getOpenWorkerSession(businessDayId: BusinessDayId): Promise<WorkerSession | null>;
  close(): Promise<void>;
}

import type { BusinessDayId, Shop, ShopId, Worker, WorkerSession } from '@tux/domain';
import type { OperatorSessionReadModel } from '../operatorSessionReadModel';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB read-model request failed.')),
      { once: true },
    );
  });
}

function openCurrentDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open IndexedDB read model.')),
      { once: true },
    );
  });
}

export class IndexedDbOperatorSessionReadModel implements OperatorSessionReadModel {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) {
      return;
    }
    this.#database = await openCurrentDatabase(this.#name);
  }

  #db(): IDBDatabase {
    if (this.#database === null) {
      throw new Error('IndexedDB operator read model must be initialized before use.');
    }
    return this.#database;
  }

  async listActiveShops(): Promise<readonly Shop[]> {
    const transaction = this.#db().transaction('shops', 'readonly');
    const shops = (await requestResult(transaction.objectStore('shops').getAll())) as Shop[];
    return shops
      .filter((shop) => shop.active)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 2);
  }

  async listActiveWorkers(shopId: ShopId): Promise<readonly Worker[]> {
    const transaction = this.#db().transaction('workers', 'readonly');
    const workers = (await requestResult(transaction.objectStore('workers').getAll())) as Worker[];
    return workers
      .filter((worker) => worker.shopId === shopId && worker.active)
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
      );
  }

  async getOpenWorkerSession(businessDayId: BusinessDayId): Promise<WorkerSession | null> {
    const transaction = this.#db().transaction('workerSessions', 'readonly');
    const sessions = (await requestResult(
      transaction.objectStore('workerSessions').getAll(),
    )) as WorkerSession[];
    return (
      sessions
        .filter((session) => session.businessDayId === businessDayId && session.endedAt === null)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
    );
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }
}

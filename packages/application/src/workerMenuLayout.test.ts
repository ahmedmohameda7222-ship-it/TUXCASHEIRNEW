import {
  instant,
  parseEntityId,
  parseWorkerMenuLayout,
  type MenuCategory,
  type MenuCategoryId,
  type Product,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerMenuLayout,
  type WorkerMenuLayoutCatalog,
} from '@tux/domain';
import type { WorkerMenuLayoutRepository } from '@tux/persistence';
import { describe, expect, it } from 'vitest';
import {
  WorkerMenuLayoutConflictError,
  WorkerMenuLayoutService,
  type RemoteWorkerMenuLayout,
  type WorkerMenuLayoutRemoteGateway,
} from './workerMenuLayout';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const workerAId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const workerBId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');
const categoryAId = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001');
const categoryBId = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000002');
const productA1Id = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000001');
const productA2Id = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000002');
const productB1Id = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000003');

const categories: readonly MenuCategory[] = [
  { id: categoryAId, shopId, name: 'A', sortOrder: 0, active: true },
  { id: categoryBId, shopId, name: 'B', sortOrder: 1, active: true },
];

const products: readonly Product[] = [
  {
    id: productA1Id,
    shopId,
    categoryId: categoryAId,
    name: 'A1',
    description: null,
    priceMinor: 100 as Product['priceMinor'],
    imageKey: null,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 0,
  },
  {
    id: productA2Id,
    shopId,
    categoryId: categoryAId,
    name: 'A2',
    description: null,
    priceMinor: 100 as Product['priceMinor'],
    imageKey: null,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 1,
  },
  {
    id: productB1Id,
    shopId,
    categoryId: categoryBId,
    name: 'B1',
    description: null,
    priceMinor: 100 as Product['priceMinor'],
    imageKey: null,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 0,
  },
];

const catalog: WorkerMenuLayoutCatalog = { categories, products };

function key(shop: ShopId, worker: WorkerId): string {
  return `${shop}:${worker}`;
}

class MemoryRepository implements WorkerMenuLayoutRepository {
  readonly values = new Map<string, WorkerMenuLayout>();

  async get(shop: ShopId, worker: WorkerId): Promise<WorkerMenuLayout | null> {
    return this.values.get(key(shop, worker)) ?? null;
  }

  async put(layout: WorkerMenuLayout): Promise<void> {
    this.values.set(key(layout.shopId, layout.workerId), layout);
  }

  async delete(shop: ShopId, worker: WorkerId): Promise<void> {
    this.values.delete(key(shop, worker));
  }
}

class FakeGateway implements WorkerMenuLayoutRemoteGateway {
  remote = new Map<string, RemoteWorkerMenuLayout>();
  failGet = false;
  failPut = false;
  conflict = false;
  getBarrier: Promise<void> | null = null;
  onGet: (() => void) | null = null;
  putCalls = 0;

  async getWorkerMenuLayout(
    shop: ShopId,
    worker: WorkerId,
  ): Promise<RemoteWorkerMenuLayout | null> {
    this.onGet?.();
    if (this.getBarrier !== null) await this.getBarrier;
    if (this.failGet) throw new Error('offline');
    return this.remote.get(key(shop, worker)) ?? null;
  }

  async putWorkerMenuLayout(
    input: Parameters<WorkerMenuLayoutRemoteGateway['putWorkerMenuLayout']>[0],
  ) {
    this.putCalls += 1;
    if (this.conflict) throw new WorkerMenuLayoutConflictError();
    if (this.failPut) throw new Error('offline');
    const current = this.remote.get(key(input.shopId, input.workerId));
    const expected = current?.layoutVersion ?? null;
    if (expected !== input.expectedLayoutVersion) throw new WorkerMenuLayoutConflictError();
    const next: RemoteWorkerMenuLayout = {
      shopId: input.shopId,
      workerId: input.workerId,
      categoryOrder: input.categoryOrder,
      categoryAlignment: input.categoryAlignment,
      productOrderByCategory: input.productOrderByCategory,
      layoutVersion: (current?.layoutVersion ?? 0) + 1,
      updatedAt: instant(`2026-08-31T12:00:0${(current?.layoutVersion ?? 0) + 1}.000Z`),
    };
    this.remote.set(key(input.shopId, input.workerId), next);
    return next;
  }
}

function localLayout(
  input: {
    workerId?: WorkerId;
    layoutVersion?: number;
    syncState?: WorkerMenuLayout['syncState'];
    order?: readonly ProductId[];
  } = {},
): WorkerMenuLayout {
  return parseWorkerMenuLayout({
    shopId,
    workerId: input.workerId ?? workerAId,
    categoryOrder: [categoryBId, categoryAId],
    categoryAlignment: 'right',
    productOrderByCategory: {
      [categoryAId]: input.order ?? [productA2Id, productA1Id],
      [categoryBId]: [productB1Id],
    },
    layoutVersion: input.layoutVersion ?? 0,
    updatedAt: '2026-08-31T10:00:00.000Z',
    syncState: input.syncState ?? 'CLEAN',
  });
}

function remoteLayout(version: number, workerId: WorkerId = workerAId): RemoteWorkerMenuLayout {
  const layout = localLayout({ workerId, layoutVersion: version, syncState: 'CLEAN' });
  return {
    shopId: layout.shopId,
    workerId: layout.workerId,
    categoryOrder: layout.categoryOrder,
    categoryAlignment: layout.categoryAlignment,
    productOrderByCategory: layout.productOrderByCategory,
    layoutVersion: layout.layoutVersion,
    updatedAt: layout.updatedAt,
  };
}

function service(
  repository: MemoryRepository,
  gateway: FakeGateway,
  currentCatalog: WorkerMenuLayoutCatalog = catalog,
) {
  return new WorkerMenuLayoutService(
    repository,
    gateway,
    { getWorkerMenuLayoutCatalog: async () => currentCatalog },
    () => instant('2026-08-31T11:00:00.000Z'),
  );
}

const update = {
  categoryOrder: [categoryAId, categoryBId],
  categoryAlignment: 'center' as const,
  productOrderByCategory: {
    [categoryAId]: [productA2Id, productA1Id],
    [categoryBId]: [productB1Id],
  },
};

describe('WorkerMenuLayoutService', () => {
  it('commits the local Save as DIRTY even when remote persistence is unavailable', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failPut = true;
    const target = service(repository, gateway);

    const saved = await target.updateMenuLayout(shopId, workerAId, update);

    expect(saved.syncState).toBe('DIRTY');
    await expect(repository.get(shopId, workerAId)).resolves.toEqual(saved);
  });

  it('marks a DIRTY layout CLEAN and adopts the returned layoutVersion after sync succeeds', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failPut = true;
    const target = service(repository, gateway);
    await target.updateMenuLayout(shopId, workerAId, update);
    gateway.failPut = false;

    await target.syncOnce(shopId, workerAId);

    const stored = await repository.get(shopId, workerAId);
    expect(stored?.syncState).toBe('CLEAN');
    expect(stored?.layoutVersion).toBe(1);
  });

  it('preserves the local DIRTY snapshot after a failed remote sync and succeeds on a later retry', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failPut = true;
    const target = service(repository, gateway);
    const saved = await target.updateMenuLayout(shopId, workerAId, update);

    await expect(target.syncOnce(shopId, workerAId)).rejects.toThrow('offline');
    await expect(repository.get(shopId, workerAId)).resolves.toEqual(saved);

    gateway.failPut = false;
    await target.syncOnce(shopId, workerAId);
    expect((await repository.get(shopId, workerAId))?.syncState).toBe('CLEAN');
  });

  it('reconciles a DIRTY snapshot against the current catalog before remote PUT and becomes CLEAN', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const dirty = localLayout({ layoutVersion: 2, syncState: 'DIRTY' });
    await repository.put(dirty);
    gateway.remote.set(key(shopId, workerAId), remoteLayout(2));
    const reducedCatalog: WorkerMenuLayoutCatalog = {
      categories: categories.map((category) =>
        category.id === categoryBId ? { ...category, active: false } : category,
      ),
      products: products.map((product) =>
        product.id === productA2Id ? { ...product, active: false } : product,
      ),
    };
    const target = service(repository, gateway, reducedCatalog);

    await target.syncOnce(shopId, workerAId);

    const stored = await repository.get(shopId, workerAId);
    expect(stored?.syncState).toBe('CLEAN');
    expect(stored?.layoutVersion).toBe(3);
    expect(stored?.categoryOrder).toEqual([categoryAId]);
    expect(stored?.productOrderByCategory).toEqual({ [categoryAId]: [productA1Id] });
    expect(gateway.remote.get(key(shopId, workerAId))?.categoryOrder).toEqual([categoryAId]);
    expect(gateway.remote.get(key(shopId, workerAId))?.productOrderByCategory).toEqual({
      [categoryAId]: [productA1Id],
    });
  });

  it('treats explicit remote NOT_FOUND as an intentional default when no local layout exists', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const target = service(repository, gateway);

    await expect(target.load(shopId, workerAId)).resolves.toBeNull();
  });

  it('propagates remote availability failures when no local layout exists', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failGet = true;
    const target = service(repository, gateway);

    await expect(target.load(shopId, workerAId)).rejects.toThrow('offline');
  });

  it('never replaces a local DIRTY layout with a newer remote snapshot during load', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const dirty = parseWorkerMenuLayout({
      ...localLayout({ layoutVersion: 3 }),
      syncState: 'DIRTY',
    });
    await repository.put(dirty);
    gateway.remote.set(key(shopId, workerAId), remoteLayout(9));
    gateway.conflict = true;
    const target = service(repository, gateway);

    const loaded = await target.load(shopId, workerAId);

    expect(loaded?.syncState).toBe('DIRTY');
    expect(loaded?.layoutVersion).toBe(3);
    expect((await repository.get(shopId, workerAId))?.layoutVersion).toBe(3);
  });

  it('restores a missing local layout from the remote durable snapshot', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.remote.set(key(shopId, workerAId), remoteLayout(4));
    const target = service(repository, gateway);

    const loaded = await target.load(shopId, workerAId);

    expect(loaded?.layoutVersion).toBe(4);
    expect(loaded?.syncState).toBe('CLEAN');
    expect((await repository.get(shopId, workerAId))?.layoutVersion).toBe(4);
  });

  it('lets a CLEAN local layout adopt a newer remote version', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    await repository.put(localLayout({ layoutVersion: 2, syncState: 'CLEAN' }));
    const remote = remoteLayout(5);
    gateway.remote.set(key(shopId, workerAId), remote);
    const target = service(repository, gateway);

    await target.syncOnce(shopId, workerAId);

    expect((await repository.get(shopId, workerAId))?.layoutVersion).toBe(5);
  });

  it('keeps worker identities isolated', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failPut = true;
    const target = service(repository, gateway);

    await target.updateMenuLayout(shopId, workerAId, update);
    await target.updateMenuLayout(shopId, workerBId, {
      ...update,
      categoryAlignment: 'left',
      productOrderByCategory: {
        [categoryAId]: [productA1Id, productA2Id],
        [categoryBId]: [productB1Id],
      },
    });

    expect((await repository.get(shopId, workerAId))?.categoryAlignment).toBe('center');
    expect((await repository.get(shopId, workerBId))?.categoryAlignment).toBe('left');
  });

  it('recovers a lost acknowledgement when remote already contains the attempted business payload', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const attempted = localLayout({ layoutVersion: 2, syncState: 'DIRTY' });
    await repository.put(attempted);
    const remote: RemoteWorkerMenuLayout = {
      ...remoteLayout(3),
      productOrderByCategory: {
        [categoryBId]: [productB1Id],
        [categoryAId]: [productA2Id, productA1Id],
      },
      updatedAt: instant('2026-08-31T12:30:00.000Z'),
    };
    gateway.remote.set(key(shopId, workerAId), remote);
    const target = service(repository, gateway);
    const published: WorkerMenuLayout[] = [];
    target.subscribe((layout) => published.push(layout));

    await target.syncOnce(shopId, workerAId);

    const stored = await repository.get(shopId, workerAId);
    expect(stored?.syncState).toBe('CLEAN');
    expect(stored?.layoutVersion).toBe(3);
    expect(stored?.updatedAt).toBe(remote.updatedAt);
    expect(stored?.categoryOrder).toEqual(attempted.categoryOrder);
    expect(stored?.productOrderByCategory).toEqual(attempted.productOrderByCategory);
    expect(gateway.putCalls).toBe(1);
    expect(gateway.remote.get(key(shopId, workerAId))).toBe(remote);
    expect(published[published.length - 1]).toEqual(stored);
  });

  it('preserves DIRTY local data and surfaces a true CAS conflict when remote business payload differs', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const attempted = localLayout({ layoutVersion: 2, syncState: 'DIRTY' });
    await repository.put(attempted);
    const remote: RemoteWorkerMenuLayout = {
      ...remoteLayout(3),
      categoryAlignment: 'left',
    };
    gateway.remote.set(key(shopId, workerAId), remote);
    const target = service(repository, gateway);

    await expect(target.syncOnce(shopId, workerAId)).rejects.toBeInstanceOf(
      WorkerMenuLayoutConflictError,
    );

    await expect(repository.get(shopId, workerAId)).resolves.toEqual(attempted);
    expect(gateway.remote.get(key(shopId, workerAId))).toBe(remote);
  });

  it('preserves a newer local edit during lost-ack recovery and advances its base version', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const attempted = localLayout({ layoutVersion: 2, syncState: 'DIRTY' });
    await repository.put(attempted);
    gateway.remote.set(key(shopId, workerAId), {
      ...remoteLayout(3),
      updatedAt: instant('2026-08-31T12:30:00.000Z'),
    });
    let releaseRecoveryGet!: () => void;
    gateway.getBarrier = new Promise<void>((resolve) => {
      releaseRecoveryGet = resolve;
    });
    let signalRecoveryGet!: () => void;
    const recoveryGetStarted = new Promise<void>((resolve) => {
      signalRecoveryGet = resolve;
    });
    gateway.onGet = signalRecoveryGet;
    const target = service(repository, gateway);

    const syncing = target.syncOnce(shopId, workerAId);
    await recoveryGetStarted;
    const newerLocal = parseWorkerMenuLayout({
      ...attempted,
      categoryAlignment: 'center',
      productOrderByCategory: {
        [categoryAId]: [productA1Id, productA2Id],
        [categoryBId]: [productB1Id],
      },
      updatedAt: '2026-08-31T11:30:00.000Z',
    });
    await repository.put(newerLocal);
    releaseRecoveryGet();
    await syncing;

    const stored = await repository.get(shopId, workerAId);
    expect(stored?.syncState).toBe('DIRTY');
    expect(stored?.layoutVersion).toBe(3);
    expect(stored?.categoryAlignment).toBe('center');
    expect(stored?.productOrderByCategory).toEqual(newerLocal.productOrderByCategory);
    expect(stored?.updatedAt).toBe(newerLocal.updatedAt);
  });

  it('preserves DIRTY local data when the conflict recovery GET fails', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    const attempted = localLayout({ layoutVersion: 2, syncState: 'DIRTY' });
    await repository.put(attempted);
    gateway.remote.set(key(shopId, workerAId), remoteLayout(3));
    gateway.failGet = true;
    const target = service(repository, gateway);

    await expect(target.syncOnce(shopId, workerAId)).rejects.toThrow('offline');
    await expect(repository.get(shopId, workerAId)).resolves.toEqual(attempted);
  });

  it('does not silently overwrite local DIRTY data on a CAS conflict', async () => {
    const repository = new MemoryRepository();
    const gateway = new FakeGateway();
    gateway.failPut = true;
    const target = service(repository, gateway);
    const saved = await target.updateMenuLayout(shopId, workerAId, update);
    gateway.failPut = false;
    gateway.conflict = true;

    await expect(target.syncOnce(shopId, workerAId)).rejects.toBeInstanceOf(
      WorkerMenuLayoutConflictError,
    );
    await expect(repository.get(shopId, workerAId)).resolves.toEqual(saved);
  });
});

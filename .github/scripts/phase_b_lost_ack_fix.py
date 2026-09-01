from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    file.write_text(text.replace(old, new, 1))


service = 'packages/application/src/workerMenuLayout.ts'
replace_once(
    service,
    """function remoteAsClean(remote: RemoteWorkerMenuLayout): WorkerMenuLayout {
  return parseWorkerMenuLayout({ ...remote, syncState: 'CLEAN' });
}

function mutationKey(shopId: ShopId, workerId: WorkerId): string {
""",
    """function remoteAsClean(remote: RemoteWorkerMenuLayout): WorkerMenuLayout {
  return parseWorkerMenuLayout({ ...remote, syncState: 'CLEAN' });
}

interface WorkerMenuLayoutBusinessPayload {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrderByCategory: ProductOrderByCategory;
}

function sameOrderedValues<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameProductOrderByCategory(
  left: ProductOrderByCategory,
  right: ProductOrderByCategory,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!sameOrderedValues(leftKeys, rightKeys)) return false;
  return leftKeys.every((categoryId) => {
    const key = categoryId as MenuCategoryId;
    const leftOrder = left[key];
    const rightOrder = right[key];
    return (
      leftOrder !== undefined &&
      rightOrder !== undefined &&
      sameOrderedValues(leftOrder, rightOrder)
    );
  });
}

function sameWorkerMenuLayoutBusinessPayload(
  left: WorkerMenuLayoutBusinessPayload,
  right: WorkerMenuLayoutBusinessPayload,
): boolean {
  return (
    left.categoryAlignment === right.categoryAlignment &&
    sameOrderedValues(left.categoryOrder, right.categoryOrder) &&
    sameProductOrderByCategory(left.productOrderByCategory, right.productOrderByCategory)
  );
}

function mutationKey(shopId: ShopId, workerId: WorkerId): string {
""",
)
replace_once(
    service,
    """  #publish(layout: WorkerMenuLayout): void {
    for (const listener of this.#listeners) listener(layout);
  }

  async #serialize<T>(
""",
    """  #publish(layout: WorkerMenuLayout): void {
    for (const listener of this.#listeners) listener(layout);
  }

  async #adoptRemoteForAttempt(
    shopId: ShopId,
    workerId: WorkerId,
    attempted: WorkerMenuLayout,
    remote: RemoteWorkerMenuLayout,
  ): Promise<void> {
    const cleanRemote = remoteAsClean(remote);
    await this.#serializeLocalMutation(shopId, workerId, async () => {
      const current = await this.#repository.get(shopId, workerId);
      if (sameWorkerMenuLayoutSnapshot(current, attempted)) {
        await this.#repository.put(cleanRemote);
        this.#publish(cleanRemote);
        return;
      }
      if (
        current !== null &&
        current.syncState === 'DIRTY' &&
        current.layoutVersion === attempted.layoutVersion &&
        cleanRemote.layoutVersion > attempted.layoutVersion
      ) {
        const advancedDirty = parseWorkerMenuLayout({
          ...current,
          layoutVersion: cleanRemote.layoutVersion,
        });
        await this.#repository.put(advancedDirty);
        this.#publish(advancedDirty);
      }
    });
  }

  async #serialize<T>(
""",
)
replace_once(
    service,
    """        const remote = await this.#gateway.putWorkerMenuLayout({
          shopId,
          workerId,
          categoryOrder: reconciled.categoryOrder,
          categoryAlignment: reconciled.categoryAlignment,
          productOrderByCategory: reconciled.productOrderByCategory,
          expectedLayoutVersion: reconciled.layoutVersion === 0 ? null : reconciled.layoutVersion,
        });
        const cleanRemote = remoteAsClean(remote);
        await this.#serializeLocalMutation(shopId, workerId, async () => {
          const current = await this.#repository.get(shopId, workerId);
          if (sameWorkerMenuLayoutSnapshot(current, reconciled)) {
            await this.#repository.put(cleanRemote);
            this.#publish(cleanRemote);
            return;
          }
          if (
            current !== null &&
            current.syncState === 'DIRTY' &&
            current.layoutVersion === reconciled.layoutVersion
          ) {
            const advancedDirty = parseWorkerMenuLayout({
              ...current,
              layoutVersion: cleanRemote.layoutVersion,
            });
            await this.#repository.put(advancedDirty);
            this.#publish(advancedDirty);
          }
        });
        return;
""",
    """        let remote: RemoteWorkerMenuLayout;
        try {
          remote = await this.#gateway.putWorkerMenuLayout({
            shopId,
            workerId,
            categoryOrder: reconciled.categoryOrder,
            categoryAlignment: reconciled.categoryAlignment,
            productOrderByCategory: reconciled.productOrderByCategory,
            expectedLayoutVersion: reconciled.layoutVersion === 0 ? null : reconciled.layoutVersion,
          });
        } catch (error) {
          if (!(error instanceof WorkerMenuLayoutConflictError)) throw error;
          const recoveredRemote = await this.#gateway.getWorkerMenuLayout(shopId, workerId);
          if (
            recoveredRemote === null ||
            recoveredRemote.layoutVersion <= reconciled.layoutVersion ||
            !sameWorkerMenuLayoutBusinessPayload(recoveredRemote, reconciled)
          ) {
            throw error;
          }
          await this.#adoptRemoteForAttempt(shopId, workerId, reconciled, recoveredRemote);
          return;
        }

        await this.#adoptRemoteForAttempt(shopId, workerId, reconciled, remote);
        return;
""",
)

test = 'packages/application/src/workerMenuLayout.test.ts'
replace_once(
    test,
    """  failGet = false;
  failPut = false;
  conflict = false;

  async getWorkerMenuLayout(
""",
    """  failGet = false;
  failPut = false;
  conflict = false;
  getBarrier: Promise<void> | null = null;
  onGet: (() => void) | null = null;
  putCalls = 0;

  async getWorkerMenuLayout(
""",
)
replace_once(
    test,
    """  ): Promise<RemoteWorkerMenuLayout | null> {
    if (this.failGet) throw new Error('offline');
    return this.remote.get(key(shop, worker)) ?? null;
  }

  async putWorkerMenuLayout(
    input: Parameters<WorkerMenuLayoutRemoteGateway['putWorkerMenuLayout']>[0],
  ) {
    if (this.conflict) throw new WorkerMenuLayoutConflictError();
""",
    """  ): Promise<RemoteWorkerMenuLayout | null> {
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
""",
)
replace_once(
    test,
    """  it('does not silently overwrite local DIRTY data on a CAS conflict', async () => {
""",
    """  it('recovers a lost acknowledgement when remote already contains the attempted business payload', async () => {
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
""",
)

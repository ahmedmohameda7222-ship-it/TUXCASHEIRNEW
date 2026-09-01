from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    file.write_text(text.replace(old, new, 1))


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} matches for {old!r}, found {count}')
    file.write_text(text.replace(old, new))


service = 'packages/application/src/workerMenuLayout.ts'
replace_once(
    service,
    """    try {
      const remote = await this.#gateway.getWorkerMenuLayout(shopId, workerId);
      if (remote === null) return null;
      const restored = remoteAsClean(remote);
      await this.#serializeLocalMutation(shopId, workerId, async () => {
        if ((await this.#repository.get(shopId, workerId)) !== null) return;
        await this.#repository.put(restored);
        this.#publish(restored);
      });
      return reconcileWorkerMenuLayout(restored, catalog);
    } catch {
      return null;
    }
""",
    """    const remote = await this.#gateway.getWorkerMenuLayout(shopId, workerId);
    if (remote === null) return null;
    const restored = remoteAsClean(remote);
    await this.#serializeLocalMutation(shopId, workerId, async () => {
      if ((await this.#repository.get(shopId, workerId)) !== null) return;
      await this.#repository.put(restored);
      this.#publish(restored);
    });
    return reconcileWorkerMenuLayout(restored, catalog);
""",
)
replace_once(
    service,
    """      if (local?.syncState === 'DIRTY') {
        const remote = await this.#gateway.putWorkerMenuLayout({
          shopId,
          workerId,
          categoryOrder: local.categoryOrder,
          categoryAlignment: local.categoryAlignment,
          productOrderByCategory: local.productOrderByCategory,
          expectedLayoutVersion: local.layoutVersion === 0 ? null : local.layoutVersion,
        });
        const cleanRemote = remoteAsClean(remote);
        await this.#serializeLocalMutation(shopId, workerId, async () => {
          const current = await this.#repository.get(shopId, workerId);
          if (sameWorkerMenuLayoutSnapshot(current, local)) {
            await this.#repository.put(cleanRemote);
            this.#publish(cleanRemote);
            return;
          }
          if (
            current !== null &&
            current.syncState === 'DIRTY' &&
            current.layoutVersion === local.layoutVersion
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
      }
""",
    """      if (local?.syncState === 'DIRTY') {
        const catalog = await this.#catalogProvider.getWorkerMenuLayoutCatalog(shopId);
        const reconciled = reconcileWorkerMenuLayout(local, catalog);
        if (!sameWorkerMenuLayoutSnapshot(reconciled, local)) {
          const persisted = await this.#serializeLocalMutation(shopId, workerId, async () => {
            const current = await this.#repository.get(shopId, workerId);
            if (!sameWorkerMenuLayoutSnapshot(current, local)) return false;
            await this.#repository.put(reconciled);
            this.#publish(reconciled);
            return true;
          });
          if (!persisted) return;
        }

        const remote = await this.#gateway.putWorkerMenuLayout({
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
      }
""",
)

service_test = 'packages/application/src/workerMenuLayout.test.ts'
replace_once(
    service_test,
    """function service(repository: MemoryRepository, gateway: FakeGateway) {
  return new WorkerMenuLayoutService(
    repository,
    gateway,
    { getWorkerMenuLayoutCatalog: async () => catalog },
    () => instant('2026-08-31T11:00:00.000Z'),
  );
}
""",
    """function service(
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
""",
)
replace_once(
    service_test,
    """  it('never replaces a local DIRTY layout with a newer remote snapshot during load', async () => {
""",
    """  it('reconciles a DIRTY snapshot against the current catalog before remote PUT and becomes CLEAN', async () => {
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
""",
)

session_client = 'apps/operations/src/app/sessionClient.ts'
replace_once(
    session_client,
    """          const layout = await menuLayoutService.load(identity.shopId, identity.workerId);
          return compatiblePreferences(identity, layout);
""",
    """          const layout = await menuLayoutService
            .load(identity.shopId, identity.workerId)
            .catch(() => menuLayoutStore.get(identity.shopId, identity.workerId));
          return compatiblePreferences(identity, layout);
""",
)

editor_session = 'apps/operations/src/app/menuLayoutEditorSession.ts'
replace_once(editor_session, '  WorkerUiPreferences,\n', '  WorkerMenuLayout,\n')
replace_count(editor_session, 'WorkerUiPreferences | null', 'WorkerMenuLayout | null', 2)

editor_test = 'apps/operations/src/app/menuLayoutEditorSession.test.ts'
replace_once(editor_test, '  type WorkerUiPreferences,\n', '  type WorkerMenuLayout,\n')
replace_once(
    editor_test,
    """const savedPreference: WorkerUiPreferences = {
  shopId,
  workerId: workerA,
  categoryOrder: [categoryB, categoryA],
  categoryAlignment: 'right',
  productOrder: [productC, productA, productB],
  accentColor: null,
  serverVersion: 2,
  updatedAt: instant(new Date('2026-08-30T04:00:00.000Z')),
  syncState: 'CLEAN',
};
""",
    """const savedPreference: WorkerMenuLayout = {
  shopId,
  workerId: workerA,
  categoryOrder: [categoryB, categoryA],
  categoryAlignment: 'right',
  productOrderByCategory: { [categoryA]: [productC, productA, productB] },
  layoutVersion: 2,
  updatedAt: instant(new Date('2026-08-30T04:00:00.000Z')),
  syncState: 'CLEAN',
};
""",
)

product_order = 'apps/operations/src/app/menuProductOrder.ts'
replace_once(
    product_order,
    "import type { MenuCategoryId, Product, ProductId, WorkerUiPreferences } from '@tux/domain';\n",
    """import {
  flattenWorkerMenuLayoutProductOrder,
  type MenuCategoryId,
  type Product,
  type ProductId,
  type WorkerMenuLayout,
} from '@tux/domain';
""",
)
replace_once(
    product_order,
    """export function reconcileProductOrder(
  products: readonly Product[],
  preference: WorkerUiPreferences | null,
): readonly Product[] {
  const canonical = products
    .filter((product) => product.active)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (preference === null || preference.productOrder.length === 0) return canonical;

  const byId = new Map(canonical.map((product) => [product.id, product]));
  const reconciled: Product[] = [];
  const seen = new Set<ProductId>();

  for (const productId of preference.productOrder) {
""",
    """export function reconcileProductOrder(
  products: readonly Product[],
  layout: WorkerMenuLayout | null,
): readonly Product[] {
  const canonical = products
    .filter((product) => product.active)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (layout === null) return canonical;
  const productOrder = flattenWorkerMenuLayoutProductOrder(layout);
  if (productOrder.length === 0) return canonical;

  const byId = new Map(canonical.map((product) => [product.id, product]));
  const reconciled: Product[] = [];
  const seen = new Set<ProductId>();

  for (const productId of productOrder) {
""",
)
replace_once(
    product_order,
    '  preference: WorkerUiPreferences | null = null,\n): readonly Product[] {\n  const ordered = reconcileProductOrder(products, preference);\n',
    '  layout: WorkerMenuLayout | null = null,\n): readonly Product[] {\n  const ordered = reconcileProductOrder(products, layout);\n',
)

workspace = 'apps/operations/src/app/OrdersWorkspace.tsx'
replace_once(
    workspace,
    """import type {
  OperationsSessionState,
  OrdersWorkspace as OrdersWorkspaceData,
} from '@tux/application';
""",
    """import {
  workerMenuLayoutUpdateFromFlatProductOrder,
  type OperationsSessionState,
  type OrdersWorkspace as OrdersWorkspaceData,
} from '@tux/application';
""",
)
replace_once(workspace, '  type WorkerUiPreferences,\n', '  type WorkerMenuLayout,\n')
replace_once(
    workspace,
    "import { createWorkerUiPreferencesClient, type OperationsOrdersClient } from './sessionClient';\n",
    "import { createWorkerMenuLayoutClient, type OperationsOrdersClient } from './sessionClient';\n",
)
replace_once(workspace, "import { menuEditPreferenceInput } from './workerUiPreferenceEditing';\n", '')
replace_count(workspace, 'WorkerUiPreferences | null', 'WorkerMenuLayout | null', 2)
replace_once(
    workspace,
    '  const preferencesClient = useMemo(createWorkerUiPreferencesClient, []);\n',
    '  const menuLayoutClient = useMemo(createWorkerMenuLayoutClient, []);\n',
)
replace_count(workspace, 'preferencesClient', 'menuLayoutClient', 5)
replace_once(
    workspace,
    """  useEffect(() => {
    if (categoryMode === 'SEARCH') searchRef.current?.focus();
  }, [categoryMode]);
""",
    """  useEffect(() => {
    const shopId = session.shopId;
    const workerId = session.operator.id;
    return menuLayoutClient.subscribe((layout) => {
      if (layout.shopId !== shopId || layout.workerId !== workerId) return;
      dispatchWorkerMenuPreferenceLoad({
        type: 'READY',
        shopId,
        workerId,
        generation: preferenceLoadGenerationRef.current,
        preference: layout,
      });
    });
  }, [menuLayoutClient, session.operator.id, session.shopId]);

  useEffect(() => {
    if (categoryMode === 'SEARCH') searchRef.current?.focus();
  }, [categoryMode]);
""",
)
replace_once(
    workspace,
    """      const saved = await menuLayoutClient.updateMenuLayout(
        menuEditPreferenceInput(
          saveDraft.categoryOrder,
          saveDraft.categoryAlignment,
          saveDraft.productOrder,
          menuEditSession.resetRequested,
        ),
      );
""",
    """      let saved: WorkerMenuLayout | null;
      if (menuEditSession.resetRequested) {
        await menuLayoutClient.resetMenuLayout();
        saved = await menuLayoutClient.load();
        if (saved === null) throw new Error('Menu layout reset could not be reloaded.');
      } else {
        if (configuration === null) throw new Error('Menu configuration is unavailable.');
        saved = await menuLayoutClient.updateMenuLayout(
          workerMenuLayoutUpdateFromFlatProductOrder({
            categoryOrder: saveDraft.categoryOrder,
            categoryAlignment: saveDraft.categoryAlignment,
            productOrder: saveDraft.productOrder,
            catalog: {
              categories: configuration.categories,
              products: configuration.products,
            },
          }),
        );
      }
""",
)

workspace_test = 'apps/operations/src/app/OrdersWorkspace.test.ts'
replace_once(workspace_test, '  type WorkerUiPreferences,\n', '  type WorkerMenuLayout,\n')
replace_once(
    workspace_test,
    """function preference(
  categoryOrder: readonly MenuCategoryId[],
  productOrder: readonly ProductId[] = [],
): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: 'right',
    productOrder,
    accentColor: null,
    serverVersion: 4,
    updatedAt: instant(new Date('2026-08-25T04:00:00.000Z')),
    syncState: 'CLEAN',
  };
}
""",
    """function preference(
  categoryOrder: readonly MenuCategoryId[],
  productOrderByCategory: WorkerMenuLayout['productOrderByCategory'] = {},
): WorkerMenuLayout {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: 'right',
    productOrderByCategory,
    layoutVersion: 4,
    updatedAt: instant(new Date('2026-08-25T04:00:00.000Z')),
    syncState: 'CLEAN',
  };
}
""",
)
replace_once(
    workspace_test,
    'const workerPreference = preference([], [products[2]!.id, staleId, products[0]!.id]);',
    'const workerPreference = preference([], { [burgers.id]: [products[2]!.id, staleId, products[0]!.id] });',
)
replace_once(
    workspace_test,
    'const workerPreference = preference([], [products[1]!.id, products[0]!.id, products[2]!.id]);',
    'const workerPreference = preference([], { [burgers.id]: [products[1]!.id, products[0]!.id, products[2]!.id] });',
)

source_test = 'apps/operations/src/app/unifiedMenuEditMode.source.test.ts'
replace_once(
    source_test,
    """    expect(ordersWorkspaceSource).toContain('menuEditPreferenceInput');
""",
    """    expect(ordersWorkspaceSource).toContain('createWorkerMenuLayoutClient');
    expect(ordersWorkspaceSource).toContain('workerMenuLayoutUpdateFromFlatProductOrder');
    expect(ordersWorkspaceSource).toContain('menuLayoutClient.subscribe');
""",
)
replace_once(
    source_test,
    """    expect(ordersWorkspaceSource.match(/preferencesClient\\.updateMenuLayout\\(/g)).toHaveLength(1);
    expect(ordersWorkspaceSource).not.toContain('preferencesClient.update(');
""",
    """    expect(ordersWorkspaceSource.match(/menuLayoutClient\\.updateMenuLayout\\(/g)).toHaveLength(1);
    expect(ordersWorkspaceSource).toContain('menuLayoutClient.resetMenuLayout()');
    expect(ordersWorkspaceSource).not.toContain('createWorkerUiPreferencesClient');
    expect(ordersWorkspaceSource).not.toContain('preferencesClient.updateMenuLayout');
""",
)

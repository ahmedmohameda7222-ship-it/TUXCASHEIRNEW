from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
source = path.read_text()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


source = replace_once(
    source,
    '  type CategoryAlignment,\n',
    '',
    'remove legacy CategoryAlignment import',
)

source = replace_once(
    source,
    "import {\n  createWorkerMenuPreferenceLoadSession,\n  workerMenuPreferenceLoadReducer,\n  type WorkerMenuPreferenceLoadState,\n} from './menuLayoutEditorSession';",
    "import {\n  createClosedMenuLayoutEditorSession,\n  createWorkerMenuPreferenceLoadSession,\n  menuLayoutEditorReducer,\n  workerMenuPreferenceLoadReducer,\n  type MenuLayoutDraft,\n  type WorkerMenuPreferenceLoadState,\n} from './menuLayoutEditorSession';",
    'menu editor reducer imports',
)

source = replace_once(
    source,
    "  const preferenceLoadGenerationRef = useRef(0);\n",
    "  const preferenceLoadGenerationRef = useRef(0);\n  const menuEditIdentityRef = useRef({ shopId: session.shopId, workerId: session.operator.id });\n  menuEditIdentityRef.current = { shopId: session.shopId, workerId: session.operator.id };\n",
    'menu editor identity ref',
)

legacy_state = """  const [menuEditActive, setMenuEditActive] = useState(false);
  const [workerMenuPreferenceLoadSession, dispatchWorkerMenuPreferenceLoad] = useReducer(
    workerMenuPreferenceLoadReducer,
    createWorkerMenuPreferenceLoadSession(session.shopId, session.operator.id, 0),
  );
  const [categoryEditOrder, setCategoryEditOrder] = useState<readonly MenuCategoryId[]>([]);
  const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('left');
  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);
  const [activeMenuDragId, setActiveMenuDragId] = useState<string | null>(null);
  const [menuEditAnnouncement, setMenuEditAnnouncement] = useState('');
  const [menuEditSaving, setMenuEditSaving] = useState(false);
  const [menuEditError, setMenuEditError] = useState<string | null>(null);
  const [menuEditResetRequested, setMenuEditResetRequested] = useState(false);
"""
reducer_state = """  const [workerMenuPreferenceLoadSession, dispatchWorkerMenuPreferenceLoad] = useReducer(
    workerMenuPreferenceLoadReducer,
    createWorkerMenuPreferenceLoadSession(session.shopId, session.operator.id, 0),
  );
  const [menuEditSession, dispatchMenuLayoutEditor] = useReducer(
    menuLayoutEditorReducer,
    createClosedMenuLayoutEditorSession(),
  );
  const [activeMenuDragId, setActiveMenuDragId] = useState<string | null>(null);
  const [menuEditAnnouncement, setMenuEditAnnouncement] = useState('');
"""
source = replace_once(source, legacy_state, reducer_state, 'legacy menu editor state')

source = replace_once(
    source,
    "  const menuEditSensors = useSensors(\n",
    "  const menuEditActive = menuEditSession.lifecycle !== 'CLOSED';\n  const menuEditSaving = menuEditSession.lifecycle === 'SAVING';\n  const menuEditError = menuEditSession.saveError;\n  const categoryEditOrder = menuEditSession.draft?.categoryOrder ?? [];\n  const categoryEditAlignment = menuEditSession.draft?.categoryAlignment ?? 'left';\n  const menuEditProductOrder = menuEditSession.draft?.productOrder ?? [];\n  const menuEditSensors = useSensors(\n",
    'menu editor derived state',
)

source = replace_once(
    source,
    "    setCategoryMode('IDLE');\n    setMenuEditActive(false);\n    setMenuEditError(null);\n    setMenuEditResetRequested(false);\n    setSearch('');",
    "    dispatchMenuLayoutEditor({ type: 'IDENTITY_INVALIDATED', shopId, workerId });\n    setCategoryMode('IDLE');\n    setActiveMenuDragId(null);\n    setMenuEditAnnouncement('');\n    setSearch('');",
    'worker identity invalidation',
)

old_begin = """  function beginMenuEdit(): void {
    if (!workerMenuPreferencePresentation.menuEditEnabled) return;
    setCategoryMode('IDLE');
    setSearch('');
    setSelectedFamily(null);
    setMenuEditError(null);
    setMenuEditResetRequested(false);
    setCategoryEditOrder(activeCategories.map((category) => category.id));
    setCategoryEditAlignment(categoryAlignment);
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    );
    setActiveMenuDragId(null);
    setMenuEditAnnouncement(
      'Menu edit mode. Drag categories or products to reorder. Keyboard users can pick up an item with Space and move it with the arrow keys.',
    );
    setMenuEditActive(true);
  }
"""
new_begin = """  function beginMenuEdit(): void {
    if (!workerMenuPreferencePresentation.menuEditEnabled) return;
    const base: MenuLayoutDraft = {
      categoryOrder: activeCategories.map((category) => category.id),
      categoryAlignment,
      productOrder: reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    };
    dispatchMenuLayoutEditor({
      type: 'OPEN',
      shopId: session.shopId,
      workerId: session.operator.id,
      base,
    });
    setCategoryMode('IDLE');
    setSearch('');
    setSelectedFamily(null);
    setActiveMenuDragId(null);
    setMenuEditAnnouncement(
      'Menu edit mode. Drag categories or products to reorder. Keyboard users can pick up an item with Space and move it with the arrow keys.',
    );
  }

  function selectMenuEditCategory(categoryId: MenuCategoryId): void {
    if (menuEditSaving) return;
    dispatchMenuLayoutEditor({ type: 'CATEGORY_CHANGE' });
    setSelectedCategoryId(categoryId);
    setSelectedFamily(null);
    setSearch('');
  }
"""
source = replace_once(source, old_begin, new_begin, 'begin menu edit')

old_reset_cancel_save = """  function resetMenuEdit(): void {
    if (menuEditSaving) return;
    setCategoryEditOrder(configuredActiveCategories.map((category) => category.id));
    setCategoryEditAlignment('left');
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], null).map((product) => product.id),
    );
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('Menu layout reset to defaults. Save to keep the reset.');
    setMenuEditError(null);
    setMenuEditResetRequested(true);
  }

  function cancelMenuEdit(): void {
    if (menuEditSaving) return;
    setMenuEditActive(false);
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('');
    setMenuEditError(null);
    setMenuEditResetRequested(false);
  }

  async function saveMenuEdit(): Promise<void> {
    if (menuEditSaving) return;
    const saveShopId = workerMenuPreferenceLoadSession.shopId;
    const saveWorkerId = workerMenuPreferenceLoadSession.workerId;
    const saveGeneration = workerMenuPreferenceLoadSession.generation;
    setMenuEditSaving(true);
    setActiveMenuDragId(null);
    setMenuEditError(null);
    try {
      const saved = await preferencesClient.updateMenuLayout(
        menuEditPreferenceInput(
          categoryEditOrder,
          categoryEditAlignment,
          menuEditProductOrder,
          menuEditResetRequested,
        ),
      );
      dispatchWorkerMenuPreferenceLoad({
        type: 'READY',
        shopId: saveShopId,
        workerId: saveWorkerId,
        generation: saveGeneration,
        preference: saved,
      });
      setMenuEditActive(false);
      setMenuEditResetRequested(false);
      setActiveMenuDragId(null);
      setMenuEditAnnouncement('');
      setSuccessMessage('Menu layout saved');
      window.setTimeout(() => setSuccessMessage(null), 4_500);
    } catch {
      setMenuEditError('Could not save menu layout. Try again.');
    } finally {
      setMenuEditSaving(false);
    }
  }
"""
new_reset_cancel_save = """  function resetMenuEdit(): void {
    if (menuEditSaving) return;
    const draft: MenuLayoutDraft = {
      categoryOrder: configuredActiveCategories.map((category) => category.id),
      categoryAlignment: 'left',
      productOrder: reconcileProductOrder(configuration?.products ?? [], null).map(
        (product) => product.id,
      ),
    };
    dispatchMenuLayoutEditor({ type: 'RESET', draft });
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('Menu layout reset to defaults. Save to keep the reset.');
  }

  function cancelMenuEdit(): void {
    if (menuEditSaving) return;
    dispatchMenuLayoutEditor({ type: 'CANCEL_EDITOR' });
    setActiveMenuDragId(null);
    setMenuEditAnnouncement('');
  }

  async function saveMenuEdit(): Promise<void> {
    if (menuEditSaving) return;
    const saveDraft = menuEditSession.draft;
    const saveShopId = menuEditSession.openingShopId;
    const saveWorkerId = menuEditSession.openingWorkerId;
    if (saveDraft === null || saveShopId === null || saveWorkerId === null) return;
    const saveGeneration = workerMenuPreferenceLoadSession.generation;
    const saveToken = crypto.randomUUID();
    dispatchMenuLayoutEditor({ type: 'BEGIN_SAVE', saveToken });
    setActiveMenuDragId(null);
    try {
      const saved = await preferencesClient.updateMenuLayout(
        menuEditPreferenceInput(
          saveDraft.categoryOrder,
          saveDraft.categoryAlignment,
          saveDraft.productOrder,
          menuEditSession.resetRequested,
        ),
      );
      if (
        menuEditIdentityRef.current.shopId !== saveShopId ||
        menuEditIdentityRef.current.workerId !== saveWorkerId
      ) {
        return;
      }
      dispatchWorkerMenuPreferenceLoad({
        type: 'READY',
        shopId: saveShopId,
        workerId: saveWorkerId,
        generation: saveGeneration,
        preference: saved,
      });
      dispatchMenuLayoutEditor({
        type: 'SAVE_SUCCESS',
        shopId: saveShopId,
        workerId: saveWorkerId,
        saveToken,
      });
      setActiveMenuDragId(null);
      setMenuEditAnnouncement('');
      setSuccessMessage('Menu layout saved');
      window.setTimeout(() => setSuccessMessage(null), 4_500);
    } catch {
      if (
        menuEditIdentityRef.current.shopId !== saveShopId ||
        menuEditIdentityRef.current.workerId !== saveWorkerId
      ) {
        return;
      }
      dispatchMenuLayoutEditor({
        type: 'SAVE_FAILURE',
        shopId: saveShopId,
        workerId: saveWorkerId,
        saveToken,
        message: 'Could not save menu layout. Try again.',
      });
    }
  }
"""
source = replace_once(
    source,
    old_reset_cancel_save,
    new_reset_cancel_save,
    'reset cancel save reducer wiring',
)

old_dnd = """  function handleMenuEditDragStart(event: DragStartEvent): void {
    if (menuEditSaving) return;
    if (!menuEditActive) return;
    setActiveMenuDragId(String(event.active.id));
  }

  function handleMenuEditDragCancel(): void {
    if (menuEditSaving) return;
    setActiveMenuDragId(null);
  }

  function handleMenuEditDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over === null ? null : String(event.over.id);
    setActiveMenuDragId(null);

    if (!menuEditActive || menuEditSaving) return;
    if (overId === null || activeId === overId) return;

    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    const overCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === overId,
    );
    if (activeCategory !== undefined && overCategory !== undefined) {
      setMenuEditResetRequested(false);
      setCategoryEditOrder((current) => {
        const sourceIndex = current.indexOf(activeCategory.id);
        const targetIndex = current.indexOf(overCategory.id);
        if (sourceIndex < 0 || targetIndex < 0) return current;
        const next = [...current];
        const [moved] = next.splice(sourceIndex, 1);
        if (moved === undefined) return current;
        next.splice(targetIndex, 0, moved);
        setMenuEditAnnouncement(
          `${activeCategory.name} moved to position ${targetIndex + 1} of ${next.length}.`,
        );
        return next;
      });
      return;
    }

    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    const overProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === overId,
    );
    if (
      activeProduct === undefined ||
      overProduct === undefined ||
      selectedCategoryId === null ||
      activeProduct.categoryId !== selectedCategoryId ||
      overProduct.categoryId !== selectedCategoryId
    ) {
      return;
    }

    setMenuEditResetRequested(false);
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      const next = moveProductWithinCategory(
        current,
        categoryProductIds,
        activeProduct.id,
        overProduct.id,
      );
      if (next !== current) {
        const categoryOnly = next.filter(
          (productId) => productCategoryById.get(productId) === selectedCategoryId,
        );
        setMenuEditAnnouncement(
          `${activeProduct.name} moved to position ${categoryOnly.indexOf(activeProduct.id) + 1} of ${categoryOnly.length}.`,
        );
      }
      return next;
    });
  }
"""
new_dnd = """  function handleMenuEditDragStart(event: DragStartEvent): void {
    if (menuEditSaving) return;
    if (!menuEditActive) return;
    const activeId = String(event.active.id);
    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    if (activeCategory !== undefined) {
      dispatchMenuLayoutEditor({
        type: 'BEGIN_CATEGORY_PICKUP',
        categoryId: activeCategory.id,
      });
      setActiveMenuDragId(activeId);
      return;
    }
    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    if (activeProduct === undefined || selectedCategoryId === null) return;
    dispatchMenuLayoutEditor({
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: activeProduct.id,
      categoryId: selectedCategoryId,
    });
    setActiveMenuDragId(activeId);
  }

  function handleMenuEditDragCancel(): void {
    if (menuEditSaving) return;
    dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
    setActiveMenuDragId(null);
  }

  function handleMenuEditDragEnd(event: DragEndEvent): void {
    if (menuEditSaving) return;
    const activeId = String(event.active.id);
    const overId = event.over === null ? null : String(event.over.id);
    setActiveMenuDragId(null);

    if (!menuEditActive || overId === null) {
      dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
      return;
    }

    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    const overCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === overId,
    );
    if (activeCategory !== undefined && overCategory !== undefined) {
      if (activeCategory.id !== overCategory.id) {
        const sourceIndex = categoryEditOrder.indexOf(activeCategory.id);
        const targetIndex = categoryEditOrder.indexOf(overCategory.id);
        if (sourceIndex < 0 || targetIndex < 0) {
          dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
          return;
        }
        const next = [...categoryEditOrder];
        const [moved] = next.splice(sourceIndex, 1);
        if (moved === undefined) {
          dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
          return;
        }
        next.splice(targetIndex, 0, moved);
        dispatchMenuLayoutEditor({ type: 'SET_CATEGORY_ORDER', categoryOrder: next });
        setMenuEditAnnouncement(
          `${activeCategory.name} moved to position ${targetIndex + 1} of ${next.length}.`,
        );
      }
      dispatchMenuLayoutEditor({
        type: 'DROP_CATEGORY_PICKUP',
        categoryId: activeCategory.id,
      });
      return;
    }

    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    const overProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === overId,
    );
    if (
      activeProduct === undefined ||
      overProduct === undefined ||
      selectedCategoryId === null ||
      activeProduct.categoryId !== selectedCategoryId ||
      overProduct.categoryId !== selectedCategoryId
    ) {
      dispatchMenuLayoutEditor({ type: 'CANCEL_PICKUP' });
      return;
    }

    if (activeProduct.id !== overProduct.id) {
      const productCategoryById = new Map(
        (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
      );
      const categoryProductIds = menuEditProductOrder.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      const next = moveProductWithinCategory(
        menuEditProductOrder,
        categoryProductIds,
        activeProduct.id,
        overProduct.id,
      );
      if (next !== menuEditProductOrder) {
        dispatchMenuLayoutEditor({ type: 'SET_PRODUCT_ORDER', productOrder: next });
        const categoryOnly = next.filter(
          (productId) => productCategoryById.get(productId) === selectedCategoryId,
        );
        setMenuEditAnnouncement(
          `${activeProduct.name} moved to position ${categoryOnly.indexOf(activeProduct.id) + 1} of ${categoryOnly.length}.`,
        );
      }
    }
    dispatchMenuLayoutEditor({
      type: 'DROP_PRODUCT_PICKUP',
      productId: activeProduct.id,
    });
  }
"""
source = replace_once(source, old_dnd, new_dnd, 'dnd reducer wiring')

source = replace_once(
    source,
    "                            onSelect={() => {\n                              setSelectedCategoryId(category.id);\n                              setSelectedFamily(null);\n                              setSearch('');\n                            }}",
    "                            onSelect={() => selectMenuEditCategory(category.id)}",
    'edit category selection',
)

source = replace_once(
    source,
    "                            onClick={() => {\n                              setCategoryEditAlignment(alignment);\n                              setMenuEditResetRequested(false);\n                            }}",
    "                            onClick={() => {\n                              if (menuEditSaving) return;\n                              dispatchMenuLayoutEditor({\n                                type: 'SET_ALIGNMENT',\n                                categoryAlignment: alignment,\n                              });\n                            }}",
    'alignment reducer dispatch',
)

legacy_names = [
    'setMenuEditActive',
    'setCategoryEditOrder',
    'setCategoryEditAlignment',
    'setMenuEditProductOrder',
    'setMenuEditSaving',
    'setMenuEditError',
    'setMenuEditResetRequested',
]
for name in legacy_names:
    if name in source:
        raise SystemExit(f'legacy editor setter remains: {name}')

required = [
    "type: 'CATEGORY_CHANGE'",
    "type: 'BEGIN_CATEGORY_PICKUP'",
    "type: 'BEGIN_PRODUCT_PICKUP'",
    "type: 'DROP_CATEGORY_PICKUP'",
    "type: 'DROP_PRODUCT_PICKUP'",
    "type: 'CANCEL_PICKUP'",
    "type: 'RESET'",
    "type: 'CANCEL_EDITOR'",
    "type: 'BEGIN_SAVE'",
    "type: 'SAVE_SUCCESS'",
    "type: 'SAVE_FAILURE'",
    "type: 'IDENTITY_INVALIDATED'",
]
for marker in required:
    if marker not in source:
        raise SystemExit(f'missing reducer event marker: {marker}')

path.write_text(source)

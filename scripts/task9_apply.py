from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = path.read_text()

old = "  type DraftLineCustomization,\n"
new = "  type CategoryAlignment,\n  type DraftLineCustomization,\n"
if old not in text:
    raise SystemExit('domain import anchor missing')
text = text.replace(old, new, 1)

old = "import { MenuProductCard } from './MenuProductCard';\nimport type { OperationsOrdersClient } from './sessionClient';\n"
new = "import { EditPencilIcon, SearchIcon } from './icons';\nimport { MenuProductCard } from './MenuProductCard';\nimport {\n  createWorkerUiPreferencesClient,\n  type OperationsOrdersClient,\n} from './sessionClient';\n"
if old not in text:
    raise SystemExit('renderer import anchor missing')
text = text.replace(old, new, 1)

old = "  const draftScopeId = useMemo(resolveOrdersDraftScopeId, []);\n  const searchRef = useRef<HTMLInputElement>(null);\n"
new = "  const draftScopeId = useMemo(resolveOrdersDraftScopeId, []);\n  const preferencesClient = useMemo(createWorkerUiPreferencesClient, []);\n  const searchRef = useRef<HTMLInputElement>(null);\n"
if old not in text:
    raise SystemExit('client state anchor missing')
text = text.replace(old, new, 1)

old = "  const [selectedProductFamily, setSelectedProductFamily] = useState<string | null>(null);\n  const [search, setSearch] = useState('');\n  const [customizer, setCustomizer] = useState<ProductCustomizerTarget | null>(null);\n"
new = """  const [selectedProductFamily, setSelectedProductFamily] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryMode, setCategoryMode] = useState<'IDLE' | 'SEARCH' | 'EDIT'>('IDLE');
  const [categoryPreference, setCategoryPreference] = useState<WorkerUiPreferences | null>(null);
  const [categoryEditOrder, setCategoryEditOrder] = useState<readonly MenuCategoryId[]>([]);
  const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('center');
  const [categoryEditSaving, setCategoryEditSaving] = useState(false);
  const [categoryEditError, setCategoryEditError] = useState<string | null>(null);
  const [categoryResetRequested, setCategoryResetRequested] = useState(false);
  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);
  const [customizer, setCustomizer] = useState<ProductCustomizerTarget | null>(null);
"""
if old not in text:
    raise SystemExit('category state anchor missing')
text = text.replace(old, new, 1)

keyboard_start = text.index(
    "  useEffect(() => {\n    function onKeyDown(event: KeyboardEvent): void {",
    text.index('export function OrdersWorkspace'),
)
keyboard_end_marker = "  }, [search]);\n"
keyboard_end = text.index(keyboard_end_marker, keyboard_start) + len(keyboard_end_marker)
preference_and_keyboard = """  useEffect(() => {
    let cancelled = false;
    setCategoryPreference(null);
    setCategoryMode('IDLE');
    setSearch('');
    setCategoryEditError(null);
    void preferencesClient
      .load()
      .then((preference) => {
        if (!cancelled) setCategoryPreference(preference);
      })
      .catch(() => {
        if (!cancelled) setCategoryPreference(null);
      });
    return () => {
      cancelled = true;
    };
  }, [preferencesClient, session.operator.id]);

  useEffect(() => {
    if (categoryMode === 'SEARCH') searchRef.current?.focus();
  }, [categoryMode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      const targetIsEditor =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (categoryMode === 'EDIT') return;
        event.preventDefault();
        setCategoryMode('SEARCH');
        return;
      }
      if (event.key === '/' && !targetIsEditor && categoryMode !== 'EDIT') {
        event.preventDefault();
        setCategoryMode('SEARCH');
        return;
      }
      if (event.key === 'Escape' && categoryMode === 'SEARCH') {
        event.preventDefault();
        if (search.length > 0) {
          setSearch('');
          searchRef.current?.focus();
        } else {
          setCategoryMode('IDLE');
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [categoryMode, search]);
"""
text = text[:keyboard_start] + preference_and_keyboard + text[keyboard_end:]

old = """  const configuration = workspace?.configuration ?? null;
  const activeCategories = useMemo(
    () =>
      configuration?.categories
        .filter((category) => category.active)
        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],
    [configuration],
  );
"""
new = """  const configuration = workspace?.configuration ?? null;
  const configuredActiveCategories = useMemo(
    () =>
      configuration?.categories
        .filter((category) => category.active)
        .sort((left, right) => left.sortOrder - right.sortOrder) ?? [],
    [configuration],
  );
  const activeCategories = useMemo(
    () => reconcileCategoryOrder(configuredActiveCategories, categoryPreference),
    [categoryPreference, configuredActiveCategories],
  );
  const categoryAlignment = categoryPreference?.categoryAlignment ?? 'center';
  const categoryEditorCategories = useMemo(() => {
    const byId = new Map(configuredActiveCategories.map((category) => [category.id, category]));
    return categoryEditOrder.flatMap((categoryId) => {
      const category = byId.get(categoryId);
      return category === undefined ? [] : [category];
    });
  }, [categoryEditOrder, configuredActiveCategories]);
"""
if old not in text:
    raise SystemExit('active categories anchor missing')
text = text.replace(old, new, 1)

insert_anchor = "  function addProduct(product: Product): void {\n"
category_functions = """  function beginCategoryEdit(): void {
    setSearch('');
    setCategoryEditOrder(activeCategories.map((category) => category.id));
    setCategoryEditAlignment(categoryAlignment);
    setCategoryEditError(null);
    setCategoryResetRequested(false);
    setDraggedCategoryId(null);
    setCategoryMode('EDIT');
  }

  function moveCategory(categoryId: MenuCategoryId, direction: -1 | 1): void {
    setCategoryEditOrder((current) => {
      const index = current.indexOf(categoryId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
    setCategoryResetRequested(false);
  }

  function dropCategory(targetId: MenuCategoryId): void {
    const sourceId = draggedCategoryId;
    setDraggedCategoryId(null);
    if (sourceId === null || sourceId === targetId) return;
    setCategoryEditOrder((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      if (moved === undefined) return current;
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setCategoryResetRequested(false);
  }

  function resetCategoryEdit(): void {
    setCategoryEditOrder(configuredActiveCategories.map((category) => category.id));
    setCategoryEditAlignment('center');
    setCategoryEditError(null);
    setCategoryResetRequested(true);
  }

  async function saveCategoryEdit(): Promise<void> {
    if (categoryEditSaving) return;
    setCategoryEditSaving(true);
    setCategoryEditError(null);
    try {
      if (categoryResetRequested) {
        await preferencesClient.reset();
        setCategoryPreference(null);
      } else {
        const saved = await preferencesClient.update({
          categoryOrder: categoryEditOrder,
          categoryAlignment: categoryEditAlignment,
        });
        setCategoryPreference(saved);
      }
      setCategoryMode('IDLE');
    } catch {
      setCategoryEditError('Could not save category layout. Try again.');
    } finally {
      setCategoryEditSaving(false);
    }
  }

"""
if insert_anchor not in text:
    raise SystemExit('category functions anchor missing')
text = text.replace(insert_anchor, category_functions + insert_anchor, 1)

toolbar_start = text.index('        <div className="menu-toolbar">')
product_grid_marker = '        <div className="product-grid" aria-live="polite">'
toolbar_end = text.index(product_grid_marker, toolbar_start)
toolbar = """        <div className={`menu-toolbar category-mode-${categoryMode.toLowerCase()}`}>
          {categoryMode === 'EDIT' ? (
            <section className="category-editor" aria-label="Edit categories">
              <div className="category-editor-toolbar">
                <div>
                  <strong>Category layout</strong>
                  <span>Drag categories or use the move controls.</span>
                </div>
                <div className="category-alignment" role="group" aria-label="Category alignment">
                  {(['left', 'center', 'right'] as const).map((alignment) => (
                    <button
                      type="button"
                      key={alignment}
                      aria-pressed={categoryEditAlignment === alignment}
                      disabled={categoryEditSaving}
                      onClick={() => {
                        setCategoryEditAlignment(alignment);
                        setCategoryResetRequested(false);
                      }}
                    >
                      {alignment === 'left' ? 'Left' : alignment === 'center' ? 'Center' : 'Right'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="category-editor-list" role="list" aria-label="Category order">
                {categoryEditorCategories.map((category, index) => (
                  <div
                    key={category.id}
                    className="category-editor-item"
                    role="listitem"
                    draggable={!categoryEditSaving}
                    onDragStart={(event) => {
                      setDraggedCategoryId(category.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', category.id);
                    }}
                    onDragEnd={() => setDraggedCategoryId(null)}
                    onDragOver={(event) => {
                      if (draggedCategoryId !== null) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropCategory(category.id);
                    }}
                  >
                    <span className="category-editor-grip" aria-hidden="true">
                      ⋮⋮
                    </span>
                    <span className="category-editor-name">{category.name}</span>
                    <div className="category-editor-move-actions">
                      <button
                        type="button"
                        aria-label={`Move ${category.name} left`}
                        disabled={categoryEditSaving || index === 0}
                        onClick={() => moveCategory(category.id, -1)}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${category.name} right`}
                        disabled={categoryEditSaving || index === categoryEditorCategories.length - 1}
                        onClick={() => moveCategory(category.id, 1)}
                      >
                        →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="category-editor-footer">
                {categoryEditError === null ? null : (
                  <span className="category-editor-error" role="alert">
                    {categoryEditError}
                  </span>
                )}
                <div className="category-editor-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={categoryEditSaving}
                    onClick={resetCategoryEdit}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={categoryEditSaving}
                    onClick={() => void saveCategoryEdit()}
                  >
                    {categoryEditSaving ? 'Saving…' : 'Done'}
                  </button>
                </div>
              </div>
            </section>
          ) : categoryMode === 'SEARCH' ? (
            <div className="product-search category-search-inline">
              <SearchIcon className="category-search-glyph" />
              <input
                ref={searchRef}
                id="product-search"
                type="search"
                aria-label="Search menu"
                value={search}
                placeholder="Search products"
                autoComplete="off"
                onChange={(event) => {
                  const nextSearch = event.target.value;
                  setSearch(nextSearch);
                  if (nextSearch.trim().length > 0) setSelectedProductFamily(null);
                }}
              />
              <kbd>Ctrl K</kbd>
              <button
                type="button"
                className="category-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setCategoryMode('IDLE');
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="field-stack category-navigation-stack">
              <div className="category-navigation">
                <div
                  className="category-rail"
                  aria-label="Menu categories"
                  data-alignment={categoryAlignment}
                >
                  {activeCategories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      className={
                        selectedCategoryId === category.id
                          ? 'category-tab selected'
                          : 'category-tab'
                      }
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        setSelectedProductFamily(null);
                        setSearch('');
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <div className="category-nav-actions">
                  <button
                    type="button"
                    className="category-icon-action"
                    aria-label="Search menu"
                    title="Search menu"
                    onClick={() => setCategoryMode('SEARCH')}
                  >
                    <SearchIcon />
                  </button>
                  <button
                    type="button"
                    className="category-edit-action"
                    onClick={beginCategoryEdit}
                  >
                    <EditPencilIcon />
                    <span>Edit categories</span>
                  </button>
                </div>
              </div>
              {productFamilies.length > 1 ? (
                <div className="segmented-control" aria-label="Product families">
                  <button
                    type="button"
                    className={selectedProductFamily === null ? 'selected' : undefined}
                    onClick={() => setSelectedProductFamily(null)}
                  >
                    All
                  </button>
                  {productFamilies.map((family) => (
                    <button
                      type="button"
                      key={family}
                      className={selectedProductFamily === family ? 'selected' : undefined}
                      onClick={() => setSelectedProductFamily(family)}
                    >
                      {family}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

"""
text = text[:toolbar_start] + toolbar + text[toolbar_end:]
path.write_text(text)

orders = Path('apps/operations/src/styles/orders.css')
orders_text = orders.read_text()
marker = '/* Task 9: progressive category navigation. */'
if marker not in orders_text:
    orders_text += """

/* Task 9: progressive category navigation. */
.category-navigation-stack {
  display: grid;
  min-width: 0;
  gap: var(--tux-space-2);
}

.category-navigation {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--tux-space-2);
  min-width: 0;
}

.category-nav-actions,
.category-editor-actions,
.category-editor-move-actions,
.category-alignment {
  display: flex;
  align-items: center;
  gap: var(--tux-space-1);
}

.category-icon-action,
.category-edit-action,
.category-search-clear,
.category-editor-move-actions button,
.category-alignment button {
  min-height: var(--tux-touch-target);
  border: 1px solid var(--tux-border-subtle);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-panel);
  color: var(--tux-text-secondary);
}

.category-icon-action {
  width: var(--tux-touch-target);
  min-width: var(--tux-touch-target);
  padding: 0;
}

.category-edit-action,
.category-search-clear,
.category-alignment button {
  padding: 0 var(--tux-space-3);
}

.category-edit-action {
  display: inline-flex;
  align-items: center;
  gap: var(--tux-space-2);
  white-space: nowrap;
}

.category-icon-action svg,
.category-edit-action svg,
.category-search-glyph {
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 auto;
}

.category-icon-action:hover,
.category-edit-action:hover,
.category-search-clear:hover,
.category-editor-move-actions button:hover:not(:disabled),
.category-alignment button:hover:not(:disabled) {
  background: var(--tux-surface-raised);
  color: var(--tux-text-primary);
}

.category-rail[data-alignment='left'] {
  justify-content: flex-start;
}

.category-rail[data-alignment='center'] {
  justify-content: safe center;
}

.category-rail[data-alignment='right'] {
  justify-content: safe flex-end;
}

.category-rail .category-tab {
  min-height: var(--tux-touch-target);
  padding-inline: 1rem;
  font-size: 0.9375rem;
  line-height: 1.25rem;
  font-weight: 500;
}

.category-rail .category-tab.selected {
  font-weight: 600;
}

.product-search.category-search-inline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--tux-space-2);
  min-width: 0;
}

.product-search.category-search-inline input {
  min-height: var(--tux-touch-target);
  padding: 0 0.875rem;
}

.product-search.category-search-inline kbd {
  position: static;
  transform: none;
  white-space: nowrap;
}

.category-editor {
  display: grid;
  min-width: 0;
  gap: var(--tux-space-2);
}

.category-editor-toolbar,
.category-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--tux-space-3);
}

.category-editor-toolbar > div:first-child {
  display: grid;
  gap: 0.125rem;
}

.category-editor-toolbar span,
.category-editor-error {
  color: var(--tux-text-secondary);
  font-size: var(--tux-font-size-xs);
  line-height: 1rem;
}

.category-editor-list {
  display: flex;
  min-width: 0;
  gap: var(--tux-space-2);
  overflow-x: auto;
  padding-bottom: var(--tux-space-1);
}

.category-editor-item {
  display: grid;
  grid-template-columns: auto minmax(max-content, 1fr) auto;
  align-items: center;
  flex: 0 0 auto;
  min-height: var(--tux-touch-target);
  gap: var(--tux-space-2);
  padding-left: var(--tux-space-2);
  border: 1px solid var(--tux-border-subtle);
  border-radius: var(--tux-radius-md);
  background: var(--tux-surface-subtle);
}

.category-editor-item[draggable='true'] {
  cursor: grab;
}

.category-editor-grip {
  color: var(--tux-text-tertiary);
  letter-spacing: -0.2em;
}

.category-editor-name {
  font-size: 0.9375rem;
  line-height: 1.25rem;
  font-weight: 500;
  white-space: nowrap;
}

.category-editor-move-actions button {
  width: var(--tux-touch-target);
  min-width: var(--tux-touch-target);
  padding: 0;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-radius: 0;
}

.category-alignment button[aria-pressed='true'] {
  border-color: var(--tux-accent);
  background: var(--tux-accent-soft);
  color: var(--tux-accent-strong);
  font-weight: 600;
}

.category-editor-footer {
  min-height: var(--tux-touch-target);
}

.category-editor-error {
  color: var(--tux-status-danger);
}

@media (max-width: 44rem) {
  .category-navigation {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .category-edit-action {
    width: var(--tux-touch-target);
    min-width: var(--tux-touch-target);
    padding: 0;
    justify-content: center;
  }

  .category-edit-action span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .product-search.category-search-inline {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .product-search.category-search-inline kbd {
    display: none;
  }

  .category-editor-toolbar,
  .category-editor-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .category-alignment,
  .category-editor-actions {
    width: 100%;
  }

  .category-alignment button,
  .category-editor-actions button {
    flex: 1 1 0;
  }
}
"""
orders.write_text(orders_text)

premium = Path('apps/operations/src/styles/premium.css')
premium_text = premium.read_text()
premium_marker = '/* Task 9 premium category surface. */'
if premium_marker not in premium_text:
    premium_text += """

/* Task 9 premium category surface. */
.menu-toolbar {
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
}

.menu-toolbar > .category-navigation-stack {
  display: grid;
  grid-column: 1;
  grid-row: auto;
}

.menu-toolbar .category-navigation .category-rail {
  grid-column: auto;
  grid-row: auto;
}

.menu-toolbar .category-rail .category-tab {
  border-color: transparent;
  font-size: 0.9375rem;
  line-height: 1.25rem;
  font-weight: 500;
}

.menu-toolbar .category-rail .category-tab.selected {
  font-weight: 600;
}

.menu-toolbar .category-search-inline,
.menu-toolbar .category-editor {
  grid-column: 1;
  grid-row: auto;
  min-width: 0;
}

.menu-toolbar .category-search-inline input {
  background: var(--tux-surface-subtle);
}

.menu-toolbar .category-icon-action,
.menu-toolbar .category-edit-action,
.menu-toolbar .category-search-clear,
.menu-toolbar .category-editor-move-actions button,
.menu-toolbar .category-alignment button {
  border-color: transparent;
  background: var(--tux-surface-subtle);
}

.menu-toolbar .category-icon-action:hover,
.menu-toolbar .category-edit-action:hover,
.menu-toolbar .category-search-clear:hover,
.menu-toolbar .category-editor-move-actions button:hover:not(:disabled),
.menu-toolbar .category-alignment button:hover:not(:disabled) {
  background: var(--tux-accent-hover-soft);
}

.menu-toolbar .category-alignment button[aria-pressed='true'] {
  background: var(--tux-accent-soft);
  color: var(--tux-accent-strong);
}

.menu-toolbar > .category-navigation-stack > .segmented-control {
  display: flex;
  width: fit-content;
  max-width: 100%;
  gap: var(--tux-space-1);
  padding: var(--tux-space-1);
  border: 1px solid var(--tux-border-subtle);
  border-radius: var(--tux-radius-md);
  background: var(--tux-surface-subtle);
  overflow-x: auto;
}
"""
premium.write_text(premium_text)

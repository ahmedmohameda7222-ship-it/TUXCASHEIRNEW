from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
source = path.read_text()

preference_import = "import { menuEditPreferenceInput } from './workerUiPreferenceEditing';\n"
if preference_import not in source:
    source = source.replace(
        "import { formatMoneyMinor, nextDraftAddedSequence, resolveOrdersDraftScopeId } from './ordersView';\n",
        "import { formatMoneyMinor, nextDraftAddedSequence, resolveOrdersDraftScopeId } from './ordersView';\n"
        + preference_import,
        1,
    )

state_anchor = '  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);\n'
if 'menuEditSaving' not in source:
    source = source.replace(
        state_anchor,
        state_anchor
        + '  const [menuEditSaving, setMenuEditSaving] = useState(false);\n'
        + '  const [menuEditError, setMenuEditError] = useState<string | null>(null);\n'
        + '  const [menuEditResetRequested, setMenuEditResetRequested] = useState(false);\n',
        1,
    )

if 'setMenuEditError(null);' not in source.split('void preferencesClient', 1)[0]:
    source = source.replace(
        "    setMenuEditActive(false);\n    setSearch('');\n",
        "    setMenuEditActive(false);\n    setMenuEditError(null);\n    setMenuEditResetRequested(false);\n    setSearch('');\n",
        1,
    )

begin_old = """  function beginMenuEdit(): void {
    setSearch('');
    setCategoryEditOrder(activeCategories.map((category) => category.id));
"""
begin_new = """  function beginMenuEdit(): void {
    setCategoryMode('IDLE');
    setSearch('');
    setSelectedFamily(null);
    setMenuEditError(null);
    setMenuEditResetRequested(false);
    setCategoryEditOrder(activeCategories.map((category) => category.id));
"""
source = source.replace(begin_old, begin_new, 1)

if 'function resetMenuEdit' not in source:
    actions = '''  function resetMenuEdit(): void {
    setCategoryEditOrder(configuredActiveCategories.map((category) => category.id));
    setCategoryEditAlignment('left');
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], null).map((product) => product.id),
    );
    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditError(null);
    setMenuEditResetRequested(true);
  }

  function cancelMenuEdit(): void {
    if (menuEditSaving) return;
    setMenuEditActive(false);
    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditError(null);
    setMenuEditResetRequested(false);
  }

  async function saveMenuEdit(): Promise<void> {
    if (menuEditSaving) return;
    setMenuEditSaving(true);
    setMenuEditError(null);
    try {
      const saved = await preferencesClient.update(
        menuEditPreferenceInput(
          categoryEditOrder,
          categoryEditAlignment,
          menuEditProductOrder,
          menuEditResetRequested,
        ),
      );
      setCategoryPreference(saved);
      setMenuEditActive(false);
      setMenuEditResetRequested(false);
      setDraggedCategoryId(null);
      setDraggedProductId(null);
      setSuccessMessage('Menu layout saved');
      window.setTimeout(() => setSuccessMessage(null), 4_500);
    } catch {
      setMenuEditError('Could not save menu layout. Try again.');
    } finally {
      setMenuEditSaving(false);
    }
  }

'''
    source = source.replace('  function moveDraggedCategory(targetId: MenuCategoryId): void {\n', actions + '  function moveDraggedCategory(targetId: MenuCategoryId): void {\n', 1)

source = source.replace(
    '    if (sourceId === null || sourceId === targetId) return;\n    setCategoryEditOrder((current) => {\n',
    '    if (sourceId === null || sourceId === targetId) return;\n    setMenuEditResetRequested(false);\n    setCategoryEditOrder((current) => {\n',
    1,
)
source = source.replace(
    '    if (sourceId === null || sourceId === targetId || selectedCategoryId === null) return;\n    const productCategoryById = new Map(\n',
    '    if (sourceId === null || sourceId === targetId || selectedCategoryId === null) return;\n    setMenuEditResetRequested(false);\n    const productCategoryById = new Map(\n',
    1,
)
source = source.replace(
    '                          onClick={() => setCategoryEditAlignment(alignment)}\n',
    '''                          onClick={() => {
                            setCategoryEditAlignment(alignment);
                            setMenuEditResetRequested(false);
                          }}
''',
    1,
)

if 'aria-label="Menu edit actions"' not in source:
    action_bar = '''
          {menuEditActive ? (
            <div className="menu-edit-actions" aria-label="Menu edit actions">
              <div className="menu-edit-action-status">
                {menuEditError === null ? null : (
                  <span className="category-editor-error" role="alert">
                    {menuEditError}
                  </span>
                )}
                <button
                  type="button"
                  className="text-action"
                  disabled={menuEditSaving}
                  onClick={resetMenuEdit}
                >Reset</button>
              </div>
              <div className="menu-edit-actions-primary">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={menuEditSaving}
                  onClick={cancelMenuEdit}
                >Cancel</button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={menuEditSaving}
                  onClick={() => void saveMenuEdit()}
                >{menuEditSaving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          ) : null}
'''
    marker = '          </div>\n        </>\n      </section>'
    if marker not in source:
        raise SystemExit('Could not locate menu grid footer for unified action bar')
    source = source.replace(marker, '          </div>\n' + action_bar + '        </>\n      </section>', 1)

if source.count('preferencesClient.update(') != 1:
    raise SystemExit('Unified menu edit must have exactly one preference persistence call')
if 'function saveMenuEdit' not in source or 'aria-label="Menu edit actions"' not in source:
    raise SystemExit('Unified menu edit actions were not installed')

path.write_text(source)

from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
source = path.read_text()

start_marker = "              {menuEditActive ? (\n"
end_marker = "            </div>\n\n            <div className=\"product-grid\""
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Task 3 category toolbar conditional')

replacement = '''              <div className="field-stack category-navigation-stack">
                <div className="category-navigation">
                  <div
                    className="category-rail"
                    aria-label="Menu categories"
                    data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}
                  >
                    {(menuEditActive ? categoryEditorCategories : activeCategories).map(
                      (category, index) => (
                        <button
                          type="button"
                          key={category.id}
                          className={[
                            'category-tab',
                            selectedCategoryId === category.id ? 'selected' : '',
                            menuEditActive ? 'category-tab-reordering' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          draggable={menuEditActive && !categoryEditSaving}
                          aria-label={
                            menuEditActive
                              ? `${category.name}, position ${index + 1} of ${categoryEditorCategories.length}`
                              : undefined
                          }
                          onDragStart={(event) => {
                            if (!menuEditActive || categoryEditSaving) return;
                            setDraggedCategoryId(category.id);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', category.id);
                          }}
                          onDragEnd={() => setDraggedCategoryId(null)}
                          onDragOver={(event) => {
                            if (menuEditActive && draggedCategoryId !== null) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            if (!menuEditActive) return;
                            event.preventDefault();
                            dropCategory(category.id);
                          }}
                          onKeyDown={(event) => {
                            if (!menuEditActive || categoryEditSaving) return;
                            if (event.key === 'ArrowLeft') {
                              event.preventDefault();
                              moveCategory(category.id, -1);
                            } else if (event.key === 'ArrowRight') {
                              event.preventDefault();
                              moveCategory(category.id, 1);
                            }
                          }}
                          onClick={() => {
                            setSelectedCategoryId(category.id);
                            if (!menuEditActive) {
                              setSelectedFamily(null);
                              setSearch('');
                            }
                          }}
                        >
                          {category.name}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="category-nav-actions">
                    {menuEditActive ? (
                      <>
                        <div
                          className="category-alignment category-alignment-inline"
                          role="group"
                          aria-label="Category alignment"
                        >
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
                              {alignment === 'left'
                                ? 'Left'
                                : alignment === 'center'
                                  ? 'Center'
                                  : 'Right'}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="category-icon-action category-edit-active"
                          aria-label="Edit menu"
                          title="Edit menu"
                          aria-pressed={menuEditActive}
                          disabled
                        >
                          <EditPencilIcon />
                        </button>
                      </>
                    ) : categoryMode === 'IDLE' ? (
                      <button
                        type="button"
                        className="category-icon-action"
                        aria-label="Edit menu"
                        title="Edit menu"
                        aria-pressed={menuEditActive}
                        onClick={beginMenuEdit}
                      >
                        <EditPencilIcon />
                      </button>
                    ) : null}
                    {menuEditActive ? null : categoryMode === 'SEARCH' ? (
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
                          onChange={(event) => setSearch(event.target.value)}
                        />
                        <button
                          type="button"
                          className="category-search-clear"
                          aria-label="Clear search"
                          title="Clear search"
                          onClick={() => {
                            setSearch('');
                            setCategoryMode('IDLE');
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="category-icon-action"
                        aria-label="Search menu"
                        title="Search menu"
                        onClick={() => setCategoryMode('SEARCH')}
                      >
                        <SearchIcon />
                      </button>
                    )}
                  </div>
                </div>
                {menuEditActive ? (
                  <div className="category-editor-footer category-editor-footer-inline">
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
                ) : activeFamilies.length > 0 ? (
                  <div
                    className="segmented-control product-family-filter"
                    aria-label="Product families"
                  >
                    <button
                      type="button"
                      className={selectedFamily === null ? 'selected' : undefined}
                      onClick={() => setSelectedFamily(null)}
                    >
                      All
                    </button>
                    {activeFamilies.map((family) => (
                      <button
                        type="button"
                        key={family}
                        className={selectedFamily === family ? 'selected' : undefined}
                        onClick={() => setSelectedFamily(family)}
                      >
                        {family}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
'''

source = source[:start] + replacement + source[end:]
path.write_text(source)

from pathlib import Path

workspace_path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
workspace = workspace_path.read_text()
old_edit = '''                  <button
                    type="button"
                    className="category-icon-action"
                    aria-label="Edit categories"
                    title="Edit categories"
                    onClick={beginCategoryEdit}
                  >
                    <EditPencilIcon />
                  </button>
                  {categoryMode === 'SEARCH' ? (
'''
new_edit = '''                  {categoryMode === 'IDLE' ? (
                    <button
                      type="button"
                      className="category-icon-action"
                      aria-label="Edit categories"
                      title="Edit categories"
                      onClick={beginCategoryEdit}
                    >
                      <EditPencilIcon />
                    </button>
                  ) : null}
                  {categoryMode === 'SEARCH' ? (
'''
if old_edit not in workspace:
    raise SystemExit('OrdersWorkspace edit/search block did not match expected source')
workspace_path.write_text(workspace.replace(old_edit, new_edit, 1))

e2e_path = Path('e2e/operations.e2e.ts')
e2e = e2e_path.read_text()
replacements = {
    "    ['Combo Smash + Required Beverage', 19_000, 1, true, false],": "    ['Combo Smash + Required Beverage', 19_000, 2, true, false],",
    "    ['Fries', 5_000, 2, false, false],": "    ['Fries', 5_000, 3, false, false],",
    "    ['Loaded Fries', 8_000, 2, false, false],": "    ['Loaded Fries', 8_000, 3, false, false],",
    "    ['Onion Rings', 6_000, 2, false, false],": "    ['Onion Rings', 6_000, 3, false, false],",
    "    ['Cola', 3_000, 3, false, false],": "    ['Cola', 3_000, 7, false, false],",
    "    ['Diet Cola', 3_000, 3, false, false],": "    ['Diet Cola', 3_000, 7, false, false],",
    "    ['Water', 2_000, 3, false, false],": "    ['Water', 2_000, 7, false, false],",
    "    ['Orange Soda', 3_000, 3, false, false],": "    ['Orange Soda', 3_000, 7, false, false],",
    "    ['Lemon Soda', 3_000, 3, false, false],": "    ['Lemon Soda', 3_000, 7, false, false],",
    "    ['Iced Tea', 4_000, 3, false, false],": "    ['Iced Tea', 4_000, 7, false, false],",
    "    soldOut: Boolean(soldOut),\n    isCombo: Boolean(isCombo),": "    soldOut: Boolean(soldOut),\n    family: index <= 3 ? 'TUX' : index <= 5 ? 'TUXIFY' : null,\n    isCombo: Boolean(isCombo),",
    "      categories: [\n        { id: category(1), shopId: SHOP, name: 'Burgers', sortOrder: 0, active: true },\n        { id: category(2), shopId: SHOP, name: 'Sides', sortOrder: 1, active: true },\n        { id: category(3), shopId: SHOP, name: 'Drinks', sortOrder: 2, active: true },\n      ],": "      categories: [\n        { id: category(1), shopId: SHOP, name: 'Burgers', sortOrder: 0, active: true },\n        { id: category(2), shopId: SHOP, name: 'Combo', sortOrder: 1, active: true },\n        { id: category(3), shopId: SHOP, name: 'Fries', sortOrder: 2, active: true },\n        { id: category(4), shopId: SHOP, name: 'Hawawshi', sortOrder: 3, active: true },\n        { id: category(5), shopId: SHOP, name: 'Zalabia', sortOrder: 4, active: true },\n        { id: category(6), shopId: SHOP, name: 'Extras', sortOrder: 5, active: true },\n        { id: category(7), shopId: SHOP, name: 'Drinks', sortOrder: 6, active: true },\n      ],",
}
for old, new in replacements.items():
    if old not in e2e:
        raise SystemExit(f'E2E source did not contain expected fragment: {old[:80]!r}')
    e2e = e2e.replace(old, new, 1)
e2e_path.write_text(e2e)

premium_path = Path('apps/operations/src/styles/premium.css')
premium = premium_path.read_text()
marker = '/* Task 2 approved two-level menu composition. */'
if marker in premium:
    raise SystemExit('Task 2 CSS already present')
premium += r'''

/* Task 2 approved two-level menu composition. */
.menu-toolbar:not(.category-mode-edit) {
  height: auto;
  min-height: 56px;
  padding: 0 8px 8px;
}

.menu-toolbar .category-navigation-stack {
  gap: 6px;
}

.menu-toolbar .category-navigation {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 56px;
}

.menu-toolbar .category-nav-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.menu-toolbar .product-family-filter {
  display: flex;
  width: fit-content;
  max-width: 100%;
  justify-self: start;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  overflow-x: auto;
}

.menu-toolbar .product-family-filter button {
  min-height: 44px;
  padding-inline: 14px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.menu-toolbar .product-family-filter button.selected {
  font-weight: 600;
}

.menu-toolbar .category-search-inline {
  position: relative;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 44px;
  width: clamp(240px, 21vw, 300px);
  max-width: 320px;
  height: 44px;
  align-items: center;
  gap: 0;
  border: 1px solid var(--tux-border-subtle);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-subtle);
  overflow: hidden;
}

.menu-toolbar .category-search-inline .category-search-glyph {
  margin-left: 10px;
}

.menu-toolbar .category-search-inline input {
  width: 100%;
  height: 44px;
  min-height: 44px;
  border: 0;
  background: transparent;
  padding: 0 8px 0 10px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
  outline: none;
}

.menu-toolbar .category-search-inline .category-search-clear {
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--tux-border-subtle) 60%, transparent);
  border-radius: 0;
  background: transparent;
}

@media (max-width: 54rem) {
  .menu-toolbar .category-navigation {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .menu-toolbar .category-search-inline {
    width: clamp(240px, 42vw, 300px);
  }
}
'''
premium_path.write_text(premium)

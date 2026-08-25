from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = path.read_text()

old_selection = """      setSelectedCategoryId((current) =>
        current !== null && categories.some((category) => category.id === current)
          ? current
          : (categories[0]?.id ?? null),
      );"""
new_selection = """      setSelectedCategoryId((current) =>
        current === null || categories.some((category) => category.id === current) ? current : null,
      );"""

old_filter = """        : active.filter(
            (product) =>
              product.categoryId === selectedCategoryId &&
              (selectedProductFamily === null || product.family === selectedProductFamily),
          );"""
new_filter = """        : active.filter(
            (product) =>
              selectedCategoryId === null ||
              (product.categoryId === selectedCategoryId &&
                (selectedProductFamily === null || product.family === selectedProductFamily)),
          );"""

old_tabs = """                  {activeCategories.map((category) => (
                    <button"""
new_tabs = """                  <button
                    type=\"button\"
                    className={selectedCategoryId === null ? 'category-tab selected' : 'category-tab'}
                    onClick={() => {
                      setSelectedCategoryId(null);
                      setSelectedProductFamily(null);
                      setSearch('');
                    }}
                  >
                    All
                  </button>
                  {activeCategories.map((category) => (
                    <button"""

replacements = [
    (old_selection, new_selection, 'default All selection'),
    (old_filter, new_filter, 'All products filter'),
    (old_tabs, new_tabs, 'synthetic All tab'),
]

for old, new, label in replacements:
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f'Expected anchor missing for {label}')
    text = text.replace(old, new, 1)

path.write_text(text)

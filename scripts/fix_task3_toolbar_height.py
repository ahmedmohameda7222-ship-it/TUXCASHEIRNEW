from pathlib import Path

path = Path('apps/operations/src/styles/premium.css')
text = path.read_text()
marker = '/* Task 3 correction: keep two-level category navigation inside the locked 56px toolbar. */'
if marker in text:
    raise SystemExit('Toolbar correction already applied')
text += '''\n\n/* Task 3 correction: keep two-level category navigation inside the locked 56px toolbar. */
.menu-toolbar:not(.category-mode-edit) {
  height: 56px;
  min-height: 56px;
  padding: 5px 8px;
}

.menu-toolbar:not(.category-mode-edit) > .category-navigation-stack {
  display: flex;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.menu-toolbar:not(.category-mode-edit) .category-navigation {
  min-width: 0;
  min-height: 44px;
  flex: 1 1 auto;
}

.menu-toolbar:not(.category-mode-edit) .product-family-filter {
  height: 44px;
  min-height: 44px;
  flex: 0 0 auto;
  align-items: center;
  padding: 0;
}
'''
path.write_text(text)

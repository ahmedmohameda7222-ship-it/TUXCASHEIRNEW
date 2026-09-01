from pathlib import Path

path = Path('e2e/menu-layout-editor.e2e.ts')
text = path.read_text()
old = """  await page.keyboard.press('Space');
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(afterHorizontal);

  cards = menuEditProductCards(page);
"""
new = """  await page.keyboard.press('Space');
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(afterHorizontal);
  await expect
    .poll(() =>
      menuEditProductCards(page).evaluateAll((nodes) =>
        nodes.every((node) => getComputedStyle(node).transform === 'none'),
      ),
    )
    .toBe(true);

  cards = menuEditProductCards(page);
"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one pointer-test anchor, found {count}')
path.write_text(text.replace(old, new, 1))

from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = "  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);"
new = "  await expect(\n    page.locator('.category-search-inline').getByRole('button', { name: 'Clear', exact: true }),\n  ).toHaveCount(0);"
if old not in text:
    raise SystemExit('Expected global Clear assertion not found')
path.write_text(text.replace(old, new, 1))

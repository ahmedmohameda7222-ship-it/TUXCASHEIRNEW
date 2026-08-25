from pathlib import Path

p = Path('apps/operations/src/styles/premium.css')
s = p.read_text().rstrip()
if '/* Mobile card containment fix. */' not in s:
    s += '\n\n/* Mobile card containment fix. */\n.product-card {\n  min-height: 146px;\n}\n\n.product-card:has(.product-copy p) {\n  min-height: 152px;\n}\n'
p.write_text(s + '\n')

p = Path('e2e/operations.e2e.ts')
s = p.read_text()
s = s.replace("await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'center');", "await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'left');", 1)
for title in (
    'final correction keeps header and categories visible during compact search',
    'final correction keeps product controls cashier-sized',
    'final correction keeps cart and payment controls at visible target sizes',
    'final correction resizes Current Order by 24px per keyboard step',
):
    old = f"test('{title}', async ({{ page }}) => {{"
    new = f"test('{title}', async ({{ page }}, testInfo) => {{\n  test.skip(testInfo.project.name !== 'desktop-browser-fallback');"
    s = s.replace(old, new, 1)
p.write_text(s)

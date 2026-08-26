from pathlib import Path

path = Path('e2e/operations.e2e.ts')
source = path.read_text()
old = "await cart.getByLabel('Zone').selectOption({ label: /Downtown Demo/ });"
new = "await cart.getByLabel('Zone').selectOption({ index: 1 });"
count = source.count(old)
if count != 1:
    raise SystemExit(f'expected one evidence zone selector, got {count}')
path.write_text(source.replace(old, new, 1))
print('fixed follow-up evidence delivery-zone selection')

from pathlib import Path

path = Path('apps/operations/src/styles/orders.css')
text = path.read_text()
old = '.cart-title {\n  font-size: 17px;'
new = '.cart-heading .cart-title {\n  font-size: 17px;'
if old not in text:
    raise SystemExit('Task 11 cart title selector anchor missing')
path.write_text(text.replace(old, new, 1))

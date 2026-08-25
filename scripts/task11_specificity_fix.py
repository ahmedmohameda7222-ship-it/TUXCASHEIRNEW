from pathlib import Path

path = Path('apps/operations/src/styles/orders.css')
text = path.read_text()
old = ".cart-title {\n  font-size: 17px;\n  line-height: 22px;\n  font-weight: 600;\n}\n\n.cart-count {\n  font-size: 13px;\n  line-height: 16px;\n  font-weight: 400;\n}"
new = ".cart-heading .cart-title {\n  font-size: 17px;\n  line-height: 22px;\n  font-weight: 600;\n}\n\n.cart-heading .cart-count {\n  font-size: 13px;\n  line-height: 16px;\n  font-weight: 400;\n}"
if old not in text:
    raise SystemExit('Task 11 heading specificity anchor missing')
path.write_text(text.replace(old, new, 1))

from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = "await searchInput.fill('cola');"
new = "await searchInput.fill('soda');"
if old not in text:
    raise SystemExit('Expected legacy cola search query not found')
path.write_text(text.replace(old, new, 1))

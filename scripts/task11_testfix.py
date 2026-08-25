from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = "  await expect(page.getByRole('status')).toContainText('Removed one Classic Smash');"
new = "  await expect(page.locator('.undo-toast')).toContainText('Removed one Classic Smash');"
if old not in text:
    raise SystemExit('Task 11 undo assertion anchor missing')
path.write_text(text.replace(old, new, 1))

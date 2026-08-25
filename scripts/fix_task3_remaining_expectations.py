from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()

replacements = [
    (
        "const inactiveCategory = categories.getByRole('button', { name: 'Sides', exact: true });",
        "const inactiveCategory = categories.getByRole('button', { name: 'Combo', exact: true });",
    ),
    (
        "    'Development-only long text used to stress responsive menu layout.',",
        "    \"2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges\",",
    ),
    (
        "await page.getByRole('button', { name: 'Add one Double TUXIFY' }).click();",
        "await page.getByRole('button', { name: 'Add one Double Smashed Patty' }).click();",
    ),
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected stale Task 3 contract not found: {old}')
    text = text.replace(old, new, 1)

path.write_text(text)

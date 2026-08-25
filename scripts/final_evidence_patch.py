from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()

replacements = [
    (
        "  async function startFresh(): Promise<void> {",
        "  async function startFresh(welcomeShot: string | null = null): Promise<void> {",
    ),
    (
        "    const welcome = page.locator('.welcome-action');\n    if (await welcome.isVisible().catch(() => false)) await welcome.click();\n    await waitForActiveShell(page);",
        "    const welcome = page.locator('.welcome-action');\n    if (await welcome.isVisible().catch(() => false)) {\n      if (welcomeShot !== null) await shot(welcomeShot);\n      await welcome.click();\n    }\n    await waitForActiveShell(page);",
    ),
    (
        "    await startFresh();\n    await shot('01-1440-default-orders.png');",
        "    await startFresh('00-1440-welcome.png');\n    await shot('01-1440-default-orders.png');",
    ),
    (
        "    await described.scrollIntoViewIfNeeded();\n    await shot('04-1440-real-description-product.png');",
        "    await described.scrollIntoViewIfNeeded();",
    ),
    (
        "    await extras.getByRole('button', { name: 'Add to Order', exact: true }).click();",
        "    await extras.getByRole('button', { name: 'Add to order', exact: true }).click();",
    ),
    (
        "  await page.getByRole('button', { name: 'Done', exact: true }).focus();\n  await page.keyboard.press('Enter');\n  await expect(editor).toHaveCount(0);",
        "  const reset = editor.getByRole('button', { name: 'Reset', exact: true });\n  await reset.focus();\n  await page.keyboard.press('Space');\n  await expect(editor.getByRole('button', { name: 'Left', exact: true })).toHaveAttribute(\n    'aria-pressed',\n    'true',\n  );",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Expected evidence snippet not found: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text)

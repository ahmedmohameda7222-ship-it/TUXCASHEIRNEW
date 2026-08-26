from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Expected final-evidence normalization snippet not found: {old[:120]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "  async function startFresh(welcomeShot: string | null = null): Promise<void> {",
    "  async function startFresh(): Promise<void> {",
)

replace_once(
    "    const welcome = page.locator('.welcome-action');\n    if (await welcome.isVisible().catch(() => false)) {\n      if (welcomeShot !== null) await shot(welcomeShot);\n      await welcome.click();\n    }\n    await waitForActiveShell(page);",
    "    const welcome = page.locator('.welcome-action');\n    if (await welcome.isVisible().catch(() => false)) await welcome.click();\n    await waitForActiveShell(page);",
)

replace_once(
    "    await startFresh('00-1440-welcome.png');\n    await shot('01-1440-default-orders.png');",
    "    await startFresh();\n    await shot('01-1440-default-orders.png');",
)

replace_once(
    "    await described.scrollIntoViewIfNeeded();\n\n    await startFresh();",
    "    await described.scrollIntoViewIfNeeded();\n    await shot('04-1440-real-description-product.png');\n\n    await startFresh();",
)

replace_once(
    "    for (const [index, amount] of ['705.00', '710.00', '720.00', '750.00', '800.00'].entries()) {\n      await expect(tenders.nth(index)).toContainText(amount);\n    }\n    await shot('08-1440-single-cash.png');",
    "    for (const [index, amount] of ['705.00', '710.00', '720.00', '750.00', '800.00'].entries()) {\n      await expect(tenders.nth(index)).toContainText(amount);\n    }\n    await cash.scrollIntoViewIfNeeded();\n    await expect(tenders.first()).toBeVisible();\n    await shot('08-1440-single-cash.png');",
)

replace_once(
    "    await separator.focus();\n    await page.keyboard.press('ArrowLeft');\n    let after = await rail.boundingBox();\n    expect(after).not.toBeNull();\n    if (after!.width <= before!.width) {\n      await page.keyboard.press('ArrowRight');\n      await page.keyboard.press('ArrowRight');\n      after = await rail.boundingBox();\n      expect(after).not.toBeNull();\n    }\n    expect(after!.width).toBeGreaterThan(before!.width);",
    "    await separator.focus();\n    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowLeft');\n    const after = await rail.boundingBox();\n    expect(after).not.toBeNull();\n    expect(after!.width).toBeGreaterThanOrEqual(before!.width + 90);",
)

path.write_text(text)

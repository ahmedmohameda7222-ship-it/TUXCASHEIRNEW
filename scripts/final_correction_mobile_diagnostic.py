from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('diagnostic combo mobile hit target'"
if marker not in text:
    text += r'''

test('diagnostic combo mobile hit target', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const add = page.getByRole('button', { name: 'Add one Combo Smash + Required Beverage' });
  await add.scrollIntoViewIfNeeded();
  const buttonBox = await add.boundingBox();
  const card = add.locator('xpath=ancestor::article[contains(@class,"product-card")]');
  const cardBox = await card.boundingBox();
  const details = await add.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const top = document.elementFromPoint(x, y);
    const stack = document.elementsFromPoint(x, y).slice(0, 8).map((element) => ({
      tag: element.tagName,
      cls: element.getAttribute('class'),
      aria: element.getAttribute('aria-label'),
      text: element.textContent?.trim().slice(0, 80) ?? '',
      rect: (() => {
        const r = element.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      })(),
    }));
    const owner = node.closest('.product-card');
    const ownerRect = owner?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      point: { x, y },
      top: top ? { tag: top.tagName, cls: top.getAttribute('class'), aria: top.getAttribute('aria-label'), text: top.textContent?.trim().slice(0, 80) ?? '' } : null,
      ownerRect: ownerRect ? { left: ownerRect.left, top: ownerRect.top, right: ownerRect.right, bottom: ownerRect.bottom, width: ownerRect.width, height: ownerRect.height } : null,
      stack,
    };
  });
  console.log('MOBILE_HIT_DIAGNOSTIC', JSON.stringify({ buttonBox, cardBox, details }));
  expect(buttonBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(details.top?.aria).toBe('Add one Combo Smash + Required Beverage');
});
'''
path.write_text(text + '\n')

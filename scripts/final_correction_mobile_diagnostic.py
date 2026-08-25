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
    const owner = node.closest('.product-card');
    const ownerRect = owner?.getBoundingClientRect();
    const ownerStyle = owner ? getComputedStyle(owner) : null;
    const main = owner?.querySelector('.product-main');
    const footer = owner?.querySelector('.product-card-footer');
    const controls = owner?.querySelector('.product-card-controls');
    const parent = owner?.parentElement;
    const rectOf = (element: Element | null | undefined) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const styleOf = (element: Element | null | undefined) => {
      if (!element) return null;
      const s = getComputedStyle(element);
      return {
        display: s.display,
        position: s.position,
        height: s.height,
        minHeight: s.minHeight,
        maxHeight: s.maxHeight,
        overflow: s.overflow,
        flex: s.flex,
        flexBasis: s.flexBasis,
        flexGrow: s.flexGrow,
        flexShrink: s.flexShrink,
        gridTemplateRows: s.gridTemplateRows,
        gridAutoRows: s.gridAutoRows,
        alignSelf: s.alignSelf,
        contain: s.contain,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      point: { x, y },
      top: top ? { tag: top.tagName, cls: top.getAttribute('class'), aria: top.getAttribute('aria-label'), text: top.textContent?.trim().slice(0, 80) ?? '' } : null,
      ownerRect: rectOf(owner),
      ownerStyle: ownerStyle ? styleOf(owner) : null,
      main: { rect: rectOf(main), style: styleOf(main) },
      footer: { rect: rectOf(footer), style: styleOf(footer) },
      controls: { rect: rectOf(controls), style: styleOf(controls) },
      parent: { rect: rectOf(parent), style: styleOf(parent) },
      stack: document.elementsFromPoint(x, y).slice(0, 8).map((element) => ({
        tag: element.tagName,
        cls: element.getAttribute('class'),
        aria: element.getAttribute('aria-label'),
        text: element.textContent?.trim().slice(0, 80) ?? '',
        rect: rectOf(element),
      })),
    };
  });
  console.log('MOBILE_HIT_DIAGNOSTIC', JSON.stringify({ buttonBox, cardBox, details }));
  expect(buttonBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(details.top?.aria).toBe('Add one Combo Smash + Required Beverage');
});
'''
path.write_text(text + '\n')

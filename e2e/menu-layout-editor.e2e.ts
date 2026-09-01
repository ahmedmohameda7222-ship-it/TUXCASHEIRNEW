import { expect, test, type Locator } from '@playwright/test';
import {
  attachMenuLayoutScreenshot,
  expectNoHorizontalOverflow,
  holdPreferenceWriteTransaction,
  installPreferenceSaveFailure,
  menuCategoryTabs,
  menuEditProductCards,
  menuLayoutDraftSnapshot,
  releasePreferenceWriteTransaction,
  restorePreferenceSave,
  startMenuLayoutActiveOrders,
} from './menu-layout-editor-test-helpers';

async function expectSelectedCategoryInsideRail(page: Parameters<typeof menuCategoryTabs>[0]) {
  const rail = page.getByLabel('Menu categories');
  const selected = rail.locator('.category-tab.selected');
  const [railBox, selectedBox] = await Promise.all([rail.boundingBox(), selected.boundingBox()]);
  expect(railBox).not.toBeNull();
  expect(selectedBox).not.toBeNull();
  expect(selectedBox!.x).toBeGreaterThanOrEqual(railBox!.x - 1);
  expect(selectedBox!.x + selectedBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width + 1);
}

async function waitForDndKeyboardSensor(page: Parameters<typeof menuCategoryTabs>[0]) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );
}

async function keyboardMove(
  page: Parameters<typeof menuCategoryTabs>[0],
  locator: Locator,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
) {
  await locator.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.category-tab-grabbed, .menu-edit-product-card-grabbed')).toHaveCount(
    1,
  );
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press(key);
  await expect(page.locator('.menu-pane .sr-only')).toContainText(
    /(?:moved to|targeting) position/,
  );
  await page.keyboard.press('Space');
  await expect(page.locator('.category-tab-grabbed, .menu-edit-product-card-grabbed')).toHaveCount(
    0,
  );
}

interface ProductCardBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visibility: string;
}

async function productCardBoxes(cards: Locator): Promise<ProductCardBox[]> {
  return cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visibility: getComputedStyle(node).visibility,
      };
    }),
  );
}

async function productCardNames(cards: Locator): Promise<string[]> {
  return cards.evaluateAll((nodes) =>
    nodes.map((node) =>
      (node.getAttribute('aria-label') ?? '').replace(/, position \d+ of \d+$/, ''),
    ),
  );
}

function moveName(values: readonly string[], sourceIndex: number, targetIndex: number): string[] {
  const next = [...values];
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) throw new Error('Invalid Product Card move');
  next.splice(targetIndex, 0, moved);
  return next;
}

async function continuePastGreetingForWorker(
  page: Parameters<typeof menuCategoryTabs>[0],
  workerName: RegExp,
) {
  const welcomeAction = page.locator('.welcome-action');
  const targetWorker = page.getByRole('button', { name: workerName });
  await expect
    .poll(async () => (await welcomeAction.isVisible()) || (await targetWorker.isVisible()))
    .toBe(true);
  if (await welcomeAction.isVisible()) await welcomeAction.click();
  await expect(targetWorker).toBeVisible();
}

test('menu editor keeps selected category reachable and preserves Product Card geometry', async ({
  page,
}, testInfo) => {
  await startMenuLayoutActiveOrders(page);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: 'Manage order' })).toHaveCount(0);
  await expect(page.locator('.product-position-editor')).toHaveCount(0);

  const normalSingle = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const normalMediaBox = await normalSingle.locator('.product-media').boundingBox();
  expect(normalMediaBox).not.toBeNull();
  await attachMenuLayoutScreenshot(page, testInfo, `${testInfo.project.name}-menu-normal`);

  const rail = page.getByLabel('Menu categories');
  await rail.getByRole('button', { name: 'Drinks', exact: true }).click();
  await rail.evaluate((node) => {
    node.scrollLeft = 0;
  });
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect(page.getByRole('button', { name: 'Edit menu' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectSelectedCategoryInsideRail(page);
  await attachMenuLayoutScreenshot(page, testInfo, `${testInfo.project.name}-selected-category`);

  const actionBar = page.getByLabel('Menu edit actions');
  await expect(actionBar).toBeVisible();
  if (testInfo.project.name !== 'desktop-browser-fallback') {
    const actionBox = await actionBar.boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
      testInfo.project.use.viewport!.height + 1,
    );
  }

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await rail.getByRole('button', { name: 'Burgers', exact: true }).click();
  await page.getByRole('button', { name: 'Edit menu' }).click();
  const editSingle = page
    .locator('.menu-edit-product-card')
    .filter({ hasText: 'Single Smashed Patty' });
  const editMediaBox = await editSingle.locator('.product-media').boundingBox();
  expect(editMediaBox).not.toBeNull();
  expect(editMediaBox!.width).toBeCloseTo(normalMediaBox!.width, 0);
  expect(editMediaBox!.height).toBeCloseTo(normalMediaBox!.height, 0);

  if (testInfo.project.name === 'desktop-browser-fallback') {
    await attachMenuLayoutScreenshot(page, testInfo, 'desktop-menu-edit');
  }

  if (testInfo.project.name === 'mobile-browser-fallback') {
    const cards = menuEditProductCards(page);
    const [first, second] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs(first!.x - second!.x)).toBeLessThanOrEqual(1);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    await keyboardMove(page, cards.nth(1), 'ArrowDown');
    await expect(cards.nth(2)).toContainText('Double Smashed Patty');
  }

  if (testInfo.project.name === 'mobile-tablet-browser-fallback') {
    await attachMenuLayoutScreenshot(page, testInfo, 'tablet-menu-edit');
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page
        .locator('.menu-edit-product-card')
        .first()
        .evaluate((node) => getComputedStyle(node).animationName),
    )
    .toBe('none');
  await attachMenuLayoutScreenshot(page, testInfo, `${testInfo.project.name}-reduced-motion-edit`);
  await expectNoHorizontalOverflow(page);
});

test('desktop Apple-style Menu Edit reflows categories and Product Cards live in 2D', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback', 'desktop acceptance');
  await startMenuLayoutActiveOrders(page);
  await page.getByRole('button', { name: 'Edit menu' }).click();

  const categories = menuCategoryTabs(page);
  const burgers = categories.getByText('Burgers', { exact: true });
  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.category-tab.menu-edit-drag-overlay')).toHaveCount(1);
  await expect(burgers).toHaveCSS('visibility', 'hidden');
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press('ArrowRight');
  await expect(categories.nth(0)).toHaveText('Combo');
  await expect(categories.nth(1)).toHaveText('Burgers');
  await page.keyboard.press('Escape');
  await expect(categories.nth(0)).toHaveText('Burgers');
  await expect(categories.nth(1)).toHaveText('Combo');

  let cards = menuEditProductCards(page);
  const beforeKeyboard = await productCardNames(cards);
  let boxes = await productCardBoxes(cards);
  expect(boxes.length).toBeGreaterThan(4);
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(2);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);

  await cards.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(cards.nth(0)).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.menu-edit-product-card-dragging.menu-edit-drag-overlay')).toHaveCount(
    1,
  );
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press('ArrowRight');
  const afterHorizontal = moveName(beforeKeyboard, 0, 1);
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(afterHorizontal);
  await expect(page.locator('.menu-pane .sr-only')).toContainText('moved to position');
  await page.keyboard.press('Space');
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(afterHorizontal);
  await expect
    .poll(() =>
      menuEditProductCards(page).evaluateAll((nodes) =>
        nodes.every((node) => getComputedStyle(node).transform === 'none'),
      ),
    )
    .toBe(true);

  cards = menuEditProductCards(page);
  const beforePointer = await productCardNames(cards);
  boxes = await productCardBoxes(cards);
  const pointerSourceIndex = 0;
  const sourceBox = boxes[pointerSourceIndex];
  expect(sourceBox).toBeDefined();
  const pointerTargetIndex = boxes.findIndex(
    (box, index) => index > pointerSourceIndex && box.y > sourceBox!.y + 2,
  );
  expect(pointerTargetIndex).toBeGreaterThan(1);
  const targetBox = boxes[pointerTargetIndex];
  expect(targetBox).toBeDefined();
  const expectedPointer = moveName(beforePointer, pointerSourceIndex, pointerTargetIndex);

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    sourceBox!.x + sourceBox!.width / 2 + 8,
    sourceBox!.y + sourceBox!.height / 2 + 4,
    { steps: 2 },
  );
  await expect(page.locator('.menu-edit-product-card-dragging.menu-edit-drag-overlay')).toHaveCount(
    1,
  );
  await expect(cards.nth(pointerSourceIndex)).toHaveCSS('visibility', 'hidden');
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, {
    steps: 8,
  });
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(expectedPointer);
  await attachMenuLayoutScreenshot(page, testInfo, 'desktop-menu-drag-live-2d');
  await page.mouse.up();
  await expect.poll(() => productCardNames(menuEditProductCards(page))).toEqual(expectedPointer);

  const expectedDraft = await menuLayoutDraftSnapshot(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Menu layout saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(expectedDraft);
  await expectNoHorizontalOverflow(page);
});

test('dirty shell exits keep or discard the exact editor transaction', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback', 'desktop shell guard acceptance');
  await startMenuLayoutActiveOrders(page);
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  const dirtyDraft = await menuLayoutDraftSnapshot(page);

  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  let guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await expect(guard).toBeVisible();
  await expect(guard.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await attachMenuLayoutScreenshot(page, testInfo, 'desktop-menu-guard');
  await page.keyboard.press('Escape');
  await expect(guard).toBeHidden();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(dirtyDraft);

  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await guard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Orders Board' })).toBeVisible();

  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Center', exact: true }).click();
  await page.getByRole('button', { name: /Demo Worker One/ }).click();
  await page.getByRole('menuitem', { name: 'Switch / Sign in worker' }).click();
  guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('button', { name: 'Edit menu' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: /Demo Worker One/ }).click();
  await page.getByRole('menuitem', { name: 'Switch / Sign in worker' }).click();
  guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await guard.getByRole('button', { name: 'Discard changes' }).click();
  const switchDialog = page.getByRole('dialog', { name: 'Switch worker' });
  await switchDialog.getByLabel('Enter PIN to Sign In').fill('5678');
  await switchDialog.getByRole('button', { name: 'Sign In' }).click();
  await expect(switchDialog).toBeHidden();
  await continuePastGreetingForWorker(page, /Demo Worker Two/);

  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('button', { name: /Demo Worker Two/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('button', { name: 'Edit menu' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: /Demo Worker Two/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await guard.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('Business Day active — operator sign-in required')).toBeVisible();
});

test('pickup rollback, save failure, and save-in-flight freeze preserve transaction invariants', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback', 'desktop transaction acceptance');
  await startMenuLayoutActiveOrders(page);
  await page.getByRole('button', { name: 'Edit menu' }).click();

  let cards = menuEditProductCards(page);
  const baseline = await menuLayoutDraftSnapshot(page);
  await cards.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.menu-edit-product-card-grabbed')).toHaveCount(1);
  await waitForDndKeyboardSensor(page);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu-pane .sr-only')).toContainText('moved to position');
  await expect.poll(() => menuLayoutDraftSnapshot(page)).not.toEqual(baseline);
  await menuCategoryTabs(page).getByText('Fries', { exact: true }).click();
  await menuCategoryTabs(page).getByText('Burgers', { exact: true }).click();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(baseline);

  cards = menuEditProductCards(page);
  await keyboardMove(page, cards.nth(1), 'ArrowDown');
  const failedDraft = await menuLayoutDraftSnapshot(page);
  await installPreferenceSaveFailure(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not save menu layout' }),
  ).toBeVisible();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(failedDraft);
  await attachMenuLayoutScreenshot(page, testInfo, 'desktop-menu-save-error');
  await restorePreferenceSave(page);

  await holdPreferenceWriteTransaction(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const savingButton = page.getByRole('button', { name: 'Saving…' });
  await expect(savingButton).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('group', { name: 'Category alignment' }).getByRole('button').first(),
  ).toBeDisabled();
  await expect(menuCategoryTabs(page).first()).toBeDisabled();

  const savingDraft = await menuLayoutDraftSnapshot(page);
  cards = menuEditProductCards(page);
  await cards.nth(1).focus();
  await cards.nth(1).press('Space');
  await cards.nth(1).press('ArrowLeft');
  await cards.nth(1).press('Space');
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(savingDraft);

  const [savingSourceBox, savingTargetBox] = await Promise.all([
    cards.nth(1).boundingBox(),
    cards.nth(0).boundingBox(),
  ]);
  expect(savingSourceBox).not.toBeNull();
  expect(savingTargetBox).not.toBeNull();
  await page.mouse.move(
    savingSourceBox!.x + savingSourceBox!.width / 2,
    savingSourceBox!.y + savingSourceBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    savingTargetBox!.x + savingTargetBox!.width / 2,
    savingTargetBox!.y + savingTargetBox!.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(savingDraft);

  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard menu changes?' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Orders Board' })).toHaveCount(0);
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(failedDraft);

  await releasePreferenceWriteTransaction(page);
  await expect(page.getByRole('status').filter({ hasText: 'Menu layout saved' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

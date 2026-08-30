import { expect, test } from '@playwright/test';
import {
  attachMenuLayoutScreenshot,
  expectNoHorizontalOverflow,
  menuCategoryTabs,
  menuEditProductCards,
  menuLayoutDraftSnapshot,
  startMenuLayoutActiveOrders,
  touchDrag,
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

test('real touch reorder persists, cancel restores, and mobile editor stays reachable', async ({
  page,
}, testInfo) => {
  expect(testInfo.project.use.hasTouch).toBe(true);
  await startMenuLayoutActiveOrders(page);
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Edit menu' }).click();
  await attachMenuLayoutScreenshot(page, testInfo, 'mobile-menu-edit');
  let cards = menuEditProductCards(page);
  await expect(cards.nth(0)).toContainText('Single Smashed Patty');
  await expect(cards.nth(1)).toContainText('Double Smashed Patty');

  await touchDrag(cards.nth(1), cards.nth(0), page);
  cards = menuEditProductCards(page);
  await expect(cards.nth(0)).toContainText('Double Smashed Patty');
  await attachMenuLayoutScreenshot(page, testInfo, 'mobile-touch-drag');
  const persistedDraft = await menuLayoutDraftSnapshot(page);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Menu layout saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(persistedDraft);

  cards = menuEditProductCards(page);
  await touchDrag(cards.nth(1), cards.nth(0), page);
  await expect(menuEditProductCards(page).nth(0)).toContainText('Single Smashed Patty');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect.poll(() => menuLayoutDraftSnapshot(page)).toEqual(persistedDraft);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  const rail = page.getByLabel('Menu categories');
  await rail.getByRole('button', { name: 'Drinks', exact: true }).click();
  await rail.evaluate((node) => {
    node.scrollLeft = 0;
  });
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expectSelectedCategoryInsideRail(page);
  await attachMenuLayoutScreenshot(page, testInfo, 'mobile-selected-category');

  const actionBar = page.getByLabel('Menu edit actions');
  const viewport = page.viewportSize();
  const actionBox = await actionBar.boundingBox();
  expect(viewport).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  await attachMenuLayoutScreenshot(page, testInfo, 'mobile-sticky-actions');

  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('button', { name: 'Orders Board', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Discard menu changes?' });
  await expect(guard).toBeVisible();
  await attachMenuLayoutScreenshot(page, testInfo, 'mobile-menu-guard');
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('button', { name: 'Edit menu' })).toHaveAttribute('aria-pressed', 'true');
  await expectNoHorizontalOverflow(page);
});

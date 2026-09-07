import { expect, test } from '@playwright/test';

const routes = [
  { path: '/', text: /TUX/i },
  { path: '/order-now', text: /Order\s*Now/i },
  { path: '/tux-burger', text: /Tux Burger/i },
  { path: '/admin', text: /Admin Login/i },
] as const;

for (const route of routes) {
  test(`direct entry renders ${route.path}`, async ({ page }) => {
    const failedImages: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'image' && response.status() >= 400) {
        failedImages.push(`${response.status()} ${response.url()}`);
      }
    });
    const response = await page.goto(route.path, { waitUntil: 'networkidle' });
    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(route.text);
    expect(failedImages).toEqual([]);
  });
}

test('home images have real dimensions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const images = await page.locator('img').evaluateAll((nodes) =>
    nodes.map((node) => ({
      src: (node as HTMLImageElement).currentSrc,
      width: (node as HTMLImageElement).naturalWidth,
      height: (node as HTMLImageElement).naturalHeight,
    })),
  );
  expect(images.length).toBeGreaterThan(0);
  expect(
    images.filter((image) => image.src).every((image) => image.width > 0 && image.height > 0),
  ).toBe(true);
});

test('product deep route survives direct entry', async ({ page }) => {
  await page.goto('/products/tux-burger', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/products\/tux-burger$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

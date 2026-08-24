import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const EXPECTED_TUX_LOGO_SHA256 = 'e66522fb47d498830a2272e1e4d4fab3a430818a83b616649248f4775809c290';

test('serves and renders the canonical TUX logo asset', async ({ page, request }) => {
  const response = await request.get('/favicon.svg');
  expect(response.ok()).toBe(true);

  const bytes = await response.body();
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(EXPECTED_TUX_LOGO_SHA256);

  await page.goto('/');
  const favicon = page.locator('link[rel="icon"]');
  const faviconHref = await favicon.getAttribute('href');
  expect(faviconHref).not.toBeNull();
  expect(new URL(faviconHref ?? '', page.url()).pathname).toBe('/favicon.svg');
  await expect(page.getByRole('img', { name: 'TUX' }).first()).toBeVisible();
});

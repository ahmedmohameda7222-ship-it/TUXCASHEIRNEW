import { expect, test, type Page } from '@playwright/test';

const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const firstDraft = '55555555-5555-4555-8555-555555555555';
const secondDraft = '66666666-6666-4666-8666-666666666666';
const product = '11111111-1111-4111-8111-111111111111';
const csrfToken = 'a'.repeat(64);

type Draft = { draftId: string; draftRevision: number; changedName: string };
async function publishingFixture(page: Page) {
  let drafts: Draft[] = [
    { draftId: firstDraft, draftRevision: 1, changedName: 'Original change' },
    { draftId: secondDraft, draftRevision: 1, changedName: 'Other change' },
  ];
  let publishVersion = 48;
  let reads = 0;
  let pendingSchedule = true;
  const publishes: Record<string, unknown>[] = [];
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        csrfToken,
        principal: {
          employeeId: '33333333-3333-4333-8333-333333333333',
          businessId: '44444444-4444-4444-8444-444444444444',
          role: 'OWNER',
          permissions: ['catalog.view', 'catalog.edit', 'catalog.publish', 'catalog.pricing'],
          shopIds: [shop, otherShop],
          shopSummaries: [
            { id: shop, name: 'Maadi', active: true, temporaryClosed: false },
            { id: otherShop, name: 'Zamalek', active: true, temporaryClosed: false },
          ],
        },
      }),
    });
  });
  await page.route('**/api/admin/catalog**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const requestedShop = url.searchParams.get('shopId') ?? shop;
    if (request.method() === 'GET' && url.searchParams.get('view') === 'publishing') {
      reads += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId: requestedShop,
          currentPublishVersion: publishVersion,
          versions: [],
          schedules: pendingSchedule ? [{
            id: '77777777-7777-4777-8777-777777777777',
            shopId: requestedShop,
            draftId: firstDraft,
            expectedDraftRevision: 1,
            status: 'PENDING',
            timezone: 'Africa/Cairo',
            localScheduledAt: '2099-09-11T08:00:00',
            scheduledFor: '2099-09-11T05:00:00.000Z',
            targetBasePublishVersion: 48,
            attemptCount: 0,
            lastError: null,
          }] : [],
          draftPreviews: requestedShop === shop
            ? drafts.map((draft) => ({
                shopId: shop,
                draftId: draft.draftId,
                draftRevision: draft.draftRevision,
                basePublishVersion: 48,
                currentPublishVersion: publishVersion,
                stale: false,
                changedProductIds: [product],
                priceChangedProductIds: [],
                changedRelationCounts: {
                  productModifierLinks: 0,
                  comboBeverageOptions: 0,
                  recipeLines: 0,
                },
                changes: [{
                  entityType: 'product',
                  entityId: product,
                  before: { name: 'Original' },
                  after: { name: draft.changedName },
                }],
              }))
            : [],
        }),
      });
      return;
    }
    if (request.method() === 'POST') {
      expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
      const body = request.postDataJSON() as Record<string, unknown>;
      if (body['type'] === 'schedule.cancel') {
        pendingSchedule = false;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, status: 'CANCELLED' }),
        });
        return;
      }
      publishes.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId: body['draftId'],
          publishVersion: ++publishVersion,
          operationsConfigurationVersion: publishVersion,
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return {
    publishes,
    get reads() { return reads; },
    setDrafts(next: Draft[]) { drafts = next; },
    setVersion(next: number) { publishVersion = next; },
  };
}

const publishButton = (page: Page) => page.getByRole('button', { name: 'Publish now', exact: true });
const consent = (page: Page) =>
  page.getByRole('checkbox', {
    name: 'I reviewed the changes and confirm publication for this shop.',
  });
async function refreshPublishing(page: Page, fixture: { readonly reads: number }) {
  const prior = fixture.reads;
  // Cancelling a preserved schedule invalidates the publishing query and forces
  // a server refresh without waiting for the query's 15-second stale timeout.
  await page.getByRole('button', { name: 'Cancel scheduled publish' }).click();
  await expect.poll(() => fixture.reads).toBeGreaterThan(prior);
}

test('new server revision and changed preview invalidate checked publication before POST', async ({ page }) => {
  const fixture = await publishingFixture(page);
  await page.goto('/catalog/products/publishing');
  await expect(consent(page)).toBeVisible();
  await consent(page).check();
  await expect(publishButton(page)).toBeEnabled();

  fixture.setDrafts([
    { draftId: firstDraft, draftRevision: 2, changedName: 'Changed in another session' },
    { draftId: secondDraft, draftRevision: 1, changedName: 'Other change' },
  ]);
  await refreshPublishing(page, fixture);
  await expect(consent(page)).not.toBeChecked();
  await expect(publishButton(page)).toBeDisabled();
  expect(fixture.publishes).toHaveLength(0);

  await consent(page).check();
  await publishButton(page).click();
  await expect(page.getByText('Catalog published.')).toBeVisible();
  expect(fixture.publishes).toHaveLength(1);
  expect(fixture.publishes[0]).toMatchObject({
    type: 'draft.publish',
    shopId: shop,
    draftId: firstDraft,
    expectedDraftRevision: 2,
    expectedVersion: 48,
  });
});

test('preview content change without revision invalidates confirmation', async ({ page }) => {
  const fixture = await publishingFixture(page);
  await page.goto('/catalog/products/publishing');
  await consent(page).check();
  fixture.setDrafts([
    { draftId: firstDraft, draftRevision: 1, changedName: 'Different preview' },
    { draftId: secondDraft, draftRevision: 1, changedName: 'Other change' },
  ]);
  await refreshPublishing(page, fixture);
  await expect(consent(page)).not.toBeChecked();
  await expect(publishButton(page)).toBeDisabled();
  expect(fixture.publishes).toEqual([]);
});

test('selected draft disappearing never falls back to publishing a different draft', async ({ page }) => {
  const fixture = await publishingFixture(page);
  await page.goto('/catalog/products/publishing');
  await page.getByLabel('Changes to review').selectOption(secondDraft);
  await consent(page).check();
  fixture.setDrafts([{ draftId: firstDraft, draftRevision: 1, changedName: 'Original change' }]);
  await refreshPublishing(page, fixture);
  await expect(page.getByText('No draft ready for review')).toBeVisible();
  await expect(page.getByLabel('Changes to review')).toHaveValue('');
  await expect(publishButton(page)).toHaveCount(0);
  expect(fixture.publishes).toEqual([]);
});

test('selection and shop switch clear confirmation and requester PIN', async ({ page }) => {
  await publishingFixture(page);
  await page.goto('/catalog/products/publishing');
  const pin = page.getByLabel('Requester PIN (when required by approval policy)');
  await pin.fill('2468');
  await consent(page).check();
  await page.getByLabel('Changes to review').selectOption(secondDraft);
  await expect(consent(page)).not.toBeChecked();
  await expect(pin).toHaveValue('');
  await pin.fill('2468');
  await consent(page).check();
  await page.locator('.shop-switcher select').selectOption(otherShop);
  await expect(page.getByText('No draft ready for review')).toBeVisible();
  await page.locator('.shop-switcher select').selectOption(shop);
  await expect(pin).toHaveValue('');
  await expect(consent(page)).not.toBeChecked();
});

test('changed between confirmation and preflight fetch fails closed without POST', async ({ page }) => {
  const fixture = await publishingFixture(page);
  await page.goto('/catalog/products/publishing');
  await consent(page).check();
  fixture.setDrafts([
    { draftId: firstDraft, draftRevision: 2, changedName: 'Concurrent edit' },
    { draftId: secondDraft, draftRevision: 1, changedName: 'Other change' },
  ]);
  await publishButton(page).click();
  await expect(page.getByRole('alert')).toContainText('reviewed draft changed');
  expect(fixture.publishes).toEqual([]);
});

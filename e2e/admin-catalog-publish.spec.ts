import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draftId = '55555555-5555-4555-8555-555555555555';
const scheduleId = '66666666-6666-4666-8666-666666666666';

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish'],
    shopIds: [shopId],
  },
  csrfToken: 'a'.repeat(64),
};

type Command = Record<string, unknown> & { type?: string };

async function mockPublishing(page: Page) {
  let currentPublishVersion = 48;
  let pendingSchedule = true;
  const commands: Command[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/catalog**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.searchParams.get('view') === 'publishing') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          currentPublishVersion,
          versions: [
            {
              shopId,
              publishVersion: currentPublishVersion,
              operationsConfigurationVersion: currentPublishVersion,
              sourceKind: currentPublishVersion === 48 ? 'DRAFT' : 'ROLLBACK',
              draftId: currentPublishVersion === 48 ? draftId : null,
              publishedByEmployeeId: ownerSession.principal.employeeId,
              restoredFromPublishVersion: currentPublishVersion === 48 ? null : 47,
              publishedAt: '2026-09-11T00:00:00.000Z',
            },
            {
              shopId,
              publishVersion: 47,
              operationsConfigurationVersion: 47,
              sourceKind: 'DRAFT',
              draftId: '77777777-7777-4777-8777-777777777777',
              publishedByEmployeeId: ownerSession.principal.employeeId,
              restoredFromPublishVersion: null,
              publishedAt: '2026-09-10T12:00:00.000Z',
            },
          ],
          draftPreviews: [
            {
              draftId,
              shopId,
              basePublishVersion: 48,
              currentPublishVersion,
              draftRevision: 2,
              stale: currentPublishVersion !== 48,
              changedProductIds: ['11111111-1111-4111-8111-111111111111'],
              priceChangedProductIds: ['11111111-1111-4111-8111-111111111111'],
            },
          ],
          schedules: pendingSchedule
            ? [
                {
                  id: scheduleId,
                  shopId,
                  draftId,
                  expectedDraftRevision: 2,
                  status: 'PENDING',
                  timezone: 'Africa/Cairo',
                  localScheduledAt: '2099-09-11T08:00:00',
                  scheduledFor: '2099-09-11T05:00:00.000Z',
                  targetBasePublishVersion: 48,
                  attemptCount: 0,
                  lastError: null,
                },
              ]
            : [],
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.searchParams.get('view') === 'recurring-availability') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shopId, products: [], rules: [] }),
      });
      return;
    }

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          currentPublishVersion,
          categories: [],
          products: [],
          drafts: [
            {
              id: draftId,
              shopId,
              title: 'Lunch price update',
              status: 'DRAFT',
              basePublishVersion: 48,
              draftRevision: 2,
              publishedVersion: null,
              updatedAt: '2026-09-11T00:00:00.000Z',
            },
          ],
        }),
      });
      return;
    }

    expect(request.headers()['x-tux-admin-csrf']).toBe(ownerSession.csrfToken);
    const body = request.postDataJSON() as Command;
    commands.push(body);

    if (body.type === 'version.restore') {
      currentPublishVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sourcePublishVersion: body.sourcePublishVersion,
          publishVersion: currentPublishVersion,
          operationsConfigurationVersion: currentPublishVersion,
        }),
      });
      return;
    }
    if (body.type === 'draft.schedule') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          scheduleId: '88888888-8888-4888-8888-888888888888',
          status: 'PENDING',
          localScheduledAt: body.localScheduledAt,
          scheduledFor: '2099-09-12T05:00:00.000Z',
          timezone: 'Africa/Cairo',
          idempotentReplay: false,
        }),
      });
      return;
    }
    if (body.type === 'schedule.cancel') {
      pendingSchedule = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          scheduleId,
          status: 'CANCELLED',
          idempotentReplay: false,
        }),
      });
      return;
    }
    if (body.type === 'draft.publish') {
      currentPublishVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId,
          publishVersion: currentPublishVersion,
          operationsConfigurationVersion: currentPublishVersion,
        }),
      });
      return;
    }

    await route.fulfill({ status: 400, body: '{}' });
  });

  return { commands };
}

test('publish review shows version-fenced draft diff, history, and Cairo scheduling', async ({
  page,
}) => {
  const fixture = await mockPublishing(page);
  await page.goto('/catalog/products/publishing');

  await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
  await expect(page.getByText('Live version 48')).toBeVisible();
  await expect(page.getByText('1 product changed')).toBeVisible();
  await expect(page.getByText('1 price change')).toBeVisible();
  await expect(page.getByText('Africa/Cairo')).toBeVisible();
  await expect(page.getByText('Version 47')).toBeVisible();

  await page.getByLabel('Activation time (Cairo)').fill('2099-09-12T08:00');
  await page.getByRole('button', { name: 'Schedule publish' }).click();
  await expect(page.getByText('Publish scheduled.')).toBeVisible();
  expect(fixture.commands.at(-1)).toMatchObject({
    type: 'draft.schedule',
    draftId,
    expectedDraftRevision: 2,
    expectedVersion: 48,
    localScheduledAt: '2099-09-12T08:00',
  });
});

test('publish history restores as a new version and pending schedules can be cancelled', async ({
  page,
}) => {
  const fixture = await mockPublishing(page);
  await page.goto('/catalog/products/publishing');

  await page.getByRole('button', { name: 'Restore version 47' }).click();
  await expect(page.getByText('Restored as version 49.')).toBeVisible();
  expect(fixture.commands.at(-1)).toMatchObject({
    type: 'version.restore',
    sourcePublishVersion: 47,
    expectedVersion: 48,
  });

  await page.getByRole('button', { name: 'Cancel scheduled publish' }).click();
  await expect(page.getByText('Scheduled publish cancelled.')).toBeVisible();
  expect(fixture.commands.at(-1)).toMatchObject({
    type: 'schedule.cancel',
    scheduleId,
  });
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 900, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const) {
  test(`publish review remains usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockPublishing(page);
    await page.goto('/catalog/products/publishing');

    await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore version 47' })).toBeVisible();
    await expect(page.getByLabel('Activation time (Cairo)')).toBeVisible();
  });
}

import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_WIDE_TABLET_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const copySourceShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const draftId = '55555555-5555-4555-8555-555555555555';
const scheduleId = '66666666-6666-4666-8666-666666666666';

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: [
      'catalog.view',
      'catalog.edit',
      'catalog.pricing',
      'catalog.publish',
      'inventory.view',
      'inventory.adjust',
    ],
    shopIds: [shopId],
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken: 'a'.repeat(64),
};

type Command = Record<string, unknown> & { type?: string };

async function mockPublishing(
  page: Page,
  withCopy = false,
  copyPreviewOverrides: Record<string, unknown> = {},
  startWithoutDraft = false,
  pendingPriceApproval = false,
) {
  let currentPublishVersion = 48;
  let pendingSchedule = true;
  let hasCopyDraft = !startWithoutDraft;
  const commands: Command[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        withCopy
          ? {
              ...ownerSession,
              principal: {
                ...ownerSession.principal,
                shopIds: [shopId, copySourceShopId],
                shopSummaries: [
                  { id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false },
                  {
                    id: copySourceShopId,
                    name: 'TUX Zamalek',
                    active: true,
                    temporaryClosed: true,
                  },
                ],
              },
            }
          : ownerSession,
      ),
    });
  });

  await page.route('**/api/admin/catalog**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      withCopy &&
      request.method() === 'GET' &&
      url.searchParams.get('view') === 'publishing' &&
      url.searchParams.get('shopId') === copySourceShopId
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shopId: copySourceShopId, currentPublishVersion: 17 }),
      });
      return;
    }

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
              changedRelationCounts: {
                productModifierLinks: 0,
                comboBeverageOptions: 0,
                recipeLines: 0,
              },
            },
          ].filter(() => hasCopyDraft),
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

    if (withCopy && body.type === 'draft.create') {
      hasCopyDraft = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, draftId, draftRevision: 2, basePublishVersion: 48 }),
      });
      return;
    }
    if (withCopy && body.type === 'catalog-copy.missing-preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sourceShopId: copySourceShopId,
          targetShopId: shopId,
          targetDraftId: draftId,
          expectedSourcePublishVersion: 17,
          expectedTargetPublishVersion: 48,
          expectedTargetDraftRevision: 2,
          creationFingerprint: 'c'.repeat(64),
          missingCategories: 1,
          missingProducts: 0,
          conflicts: 1,
          allCategoriesAndProductsMapped: false,
          categories: [
            {
              sourceCategoryId: '11111111-1111-4111-8111-111111111120',
              sourceName: 'Weekend Sides',
              masterCategoryId: '11111111-1111-4111-8111-111111111121',
              targetCategoryId: null,
              proposedTargetCategoryId: '11111111-1111-5111-8111-111111111124',
              status: 'CREATE_REQUIRED',
            },
          ],
          products: [
            {
              sourceProductId: '11111111-1111-4111-8111-111111111122',
              sourceName: 'Milkshake',
              masterProductId: '11111111-1111-4111-8111-111111111123',
              targetProductId: null,
              proposedTargetProductId: null,
              proposedTargetCategoryId: null,
              status: 'CONFLICT_NAME',
            },
          ],
        }),
      });
      return;
    }
    if (withCopy && body.type === 'catalog-copy.stage-created-entities') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          targetDraftId: draftId,
          draftRevision: 3,
          createdCategories: 1,
          createdProducts: 0,
          createdCategoryIds: ['11111111-1111-5111-8111-111111111124'],
          createdProductIds: [],
          publishRequired: true,
        }),
      });
      return;
    }
    if (withCopy && body.type === 'catalog-copy.preview') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          sourceShopId: copySourceShopId,
          targetShopId: shopId,
          targetDraftId: draftId,
          mappedProducts: 1,
          changedProducts: 1,
          mappedCategories: 0,
          changedCategories: 0,
          mappedComboBeverageOptions: 0,
          changedComboBeverageOptions: 0,
          comboDifferences: [],
          mappedProductModifierLinks: 0,
          changedProductModifierLinks: 0,
          productModifierLinkDifferences: [],
          mappedModifierDefinitions: 0,
          changedModifierDefinitions: 0,
          modifierDefinitionDifferences: [],
          mappedRecipeLines: 0,
          changedRecipeLines: 0,
          recipeDifferences: [],
          categoryDifferences: [],
          fingerprint: 'e'.repeat(64),
          expectedSourcePublishVersion: 17,
          expectedTargetPublishVersion: 48,
          expectedTargetDraftRevision: 2,
          selectedDomains: ['productOrder'],
          differences: [
            {
              targetProductId: '11111111-1111-4111-8111-111111111111',
              productName: 'Classic Smash',
              sortOrderBefore: 40,
              sortOrderAfter: 5,
              priceBeforeMinor: 1550,
              priceAfterMinor: 1550,
              activeBefore: true,
              activeAfter: true,
              soldOutBefore: false,
              soldOutAfter: false,
            },
          ],
          ...copyPreviewOverrides,
        }),
      });
      return;
    }
    if (withCopy && body.type === 'catalog-copy.apply') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, draftRevision: 3 }),
      });
      return;
    }

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
      if (pendingPriceApproval) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            state: 'PENDING_APPROVAL',
            approvalRequestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          }),
        });
        return;
      }
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

async function mockAdvancedCatalog(page: Page) {
  const productId = '11111111-1111-4111-8111-111111111111';
  const categoryId = '22222222-2222-4222-8222-222222222222';
  const modifierId = '44444444-4444-4444-8444-444444444444';
  const beverageId = '99999999-9999-4999-8999-999999999999';
  const inventoryItemId = '77777777-7777-4777-8777-777777777777';
  const commands: Command[] = [];
  const product = {
    id: productId,
    shopId,
    categoryId,
    slug: 'classic-smash',
    name: 'Classic Smash',
    description: 'Single smashed burger',
    priceMinor: 1550,
    imageKey: null,
    family: 'burger',
    bestSeller: true,
    active: true,
    soldOut: false,
    isCombo: true,
    sortOrder: 10,
  };
  const bundleJson = {
    snapshot: {
      products: [
        product,
        {
          ...product,
          id: beverageId,
          slug: 'water',
          name: 'Water',
          priceMinor: 1000,
          family: 'drink',
          bestSeller: false,
          isCombo: false,
          sortOrder: 20,
        },
      ],
      categories: [],
      modifiers: [
        {
          id: modifierId,
          shopId,
          name: 'Bacon',
          priceMinor: 2000,
          standaloneProductId: null,
          active: true,
          sortOrder: 0,
        },
      ],
      productModifierLinks: [{ shopId, productId, modifierId, maxQuantity: 2, sortOrder: 0 }],
      comboBeverageOptions: [
        { shopId, comboProductId: productId, beverageProductId: beverageId, sortOrder: 0 },
      ],
      recipeLines: [{ shopId, productId, inventoryItemId, quantityMicros: 250000 }],
    },
    inventoryItems: [
      {
        id: inventoryItemId,
        shopId,
        name: 'Meat',
        unitLabel: 'g',
        trackingMode: 'RECIPE_TRACKED',
        active: true,
      },
    ],
  };

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/catalog**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          currentPublishVersion: 48,
          categories: [
            {
              id: categoryId,
              shopId,
              slug: 'smash',
              name: 'Smash',
              description: null,
              sortOrder: 0,
              active: true,
            },
          ],
          products: [product],
          drafts: [],
        }),
      });
      return;
    }

    expect(request.headers()['x-tux-admin-csrf']).toBe(ownerSession.csrfToken);
    const body = request.postDataJSON() as Command;
    commands.push(body);
    if (body.type === 'draft.create') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId,
          draftRevision: 1,
          basePublishVersion: 48,
          bundleJson,
        }),
      });
      return;
    }
    if (body.type === 'draft.save') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId,
          draftRevision: 2,
          basePublishVersion: 48,
        }),
      });
      return;
    }
    await route.fulfill({ status: 400, body: '{}' });
  });

  return { commands, productId, modifierId, beverageId, inventoryItemId };
}

test('publish review shows version-fenced draft diff and prevents unverified scheduling', async ({
  page,
}) => {
  const fixture = await mockPublishing(page);
  await page.goto('/catalog/products/publishing');

  await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1 product changed')).toBeVisible();
  await expect(page.getByText('1 price change')).toBeVisible();
  await expect(page.getByText('Automatic scheduling is unavailable')).toBeVisible();
  await expect(page.getByText('Version 47')).toBeVisible();
  await expect(page.getByLabel('Activation time (Cairo)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Schedule publish' })).toHaveCount(0);
  expect(fixture.commands).toEqual([]);
});

test('catalog price approval remains pending without falsely publishing prices', async ({
  page,
}) => {
  const fixture = await mockPublishing(page, false, {}, false, true);
  await page.goto('/catalog/products/publishing');

  await page.getByLabel('Requester PIN (when required by approval policy)').fill('2468');
  await page
    .getByRole('checkbox', {
      name: 'I reviewed the changes and confirm publication for this shop.',
    })
    .check();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(
    page.getByText(
      'Catalog publication requested. A second person must approve before it goes live.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Catalog published.')).toHaveCount(0);
  expect(fixture.commands.at(-1)).toMatchObject({
    type: 'draft.publish',
    draftId,
    shopId,
    expectedDraftRevision: 2,
    expectedVersion: 48,
    requesterPin: '2468',
  });
  await page.reload();
  await expect(page.getByText('Version 48', { exact: true }).first()).toBeVisible();
});

test('publish history restores as a new version and pending schedules can be cancelled', async ({
  page,
}) => {
  const fixture = await mockPublishing(page);
  await page.goto('/catalog/products/publishing');

  await page.getByRole('button', { name: 'Restore version 47' }).click();
  await expect(
    page.getByText('The selected catalog version was restored and published.'),
  ).toBeVisible();
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

test('advanced product controls load from a version-fenced draft and save canonical relations', async ({
  page,
}) => {
  const fixture = await mockAdvancedCatalog(page);
  await page.goto('/catalog/products');

  await page.getByRole('button', { name: /Classic Smash/ }).click();
  await page.getByRole('button', { name: /More/ }).click();
  await expect
    .poll(() => fixture.commands.some((command) => command.type === 'draft.create'))
    .toBe(true);
  await expect(page.getByText('Bacon')).toBeVisible();
  await expect(page.locator('form').getByText('Water', { exact: true })).toBeVisible();
  await expect(page.getByText(/Meat/)).toBeVisible();

  await page.getByLabel('Max quantity').fill('4');
  await page.getByLabel('Meat quantity in g').fill('0.75');
  await page.getByRole('button', { name: 'Save draft' }).click();

  await expect
    .poll(() => fixture.commands.some((command) => command.type === 'draft.save'))
    .toBe(true);
  const save = fixture.commands.find((command) => command.type === 'draft.save');
  expect(save).toBeTruthy();
  const changes = save?.changes as Array<Record<string, unknown>>;
  const change = changes[0] as Record<string, unknown>;
  expect(change.changedPaths).toEqual(
    expect.arrayContaining(['productModifierLinks', 'comboBeverageOptions', 'recipeLines']),
  );
  const savedBundle = change.bundleJson as Record<string, unknown>;
  const snapshot = savedBundle.snapshot as Record<string, unknown>;
  expect(snapshot.productModifierLinks).toContainEqual(
    expect.objectContaining({
      productId: fixture.productId,
      modifierId: fixture.modifierId,
      maxQuantity: 4,
    }),
  );
  expect(snapshot.comboBeverageOptions).toContainEqual(
    expect.objectContaining({
      comboProductId: fixture.productId,
      beverageProductId: fixture.beverageId,
    }),
  );
  expect(snapshot.recipeLines).toContainEqual(
    expect.objectContaining({
      productId: fixture.productId,
      inventoryItemId: fixture.inventoryItemId,
      quantityMicros: 750000,
    }),
  );
});

test('mobile Catalog Copy stages only selected product order through version-checked draft', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockPublishing(page, true);
  await page.goto('/catalog/products/publishing');

  await expect(page.getByRole('heading', { name: 'Selective catalog copy' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', { name: 'Product display order (mapped products only)' })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();

  await expect(page.getByText('Order: 40 → 5.')).toBeVisible();
  const preview = commands.find((command) => command.type === 'catalog-copy.preview');
  expect(preview).toMatchObject({
    sourceShopId: copySourceShopId,
    targetShopId: shopId,
    targetDraftId: draftId,
    expectedSourcePublishVersion: 17,
    expectedTargetPublishVersion: 48,
    expectedTargetDraftRevision: 2,
    selectedDomains: ['productOrder'],
  });

  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  await expect(page.getByText(/Copy staged in the target draft/)).toBeVisible();
  const apply = commands.find((command) => command.type === 'catalog-copy.apply');
  expect(apply).toMatchObject({
    sourceShopId: copySourceShopId,
    targetShopId: shopId,
    targetDraftId: draftId,
    selectedDomains: ['productOrder'],
    previewFingerprint: 'e'.repeat(64),
    expectedTargetDraftRevision: 2,
  });
  expect(typeof apply?.commandId).toBe('string');
});

test('mobile Catalog Copy previews missing identities without staging or publishing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockPublishing(page, true);
  await page.goto('/catalog/products/publishing');

  await page.getByRole('button', { name: 'Inspect target master mappings' }).click();
  await expect(page.getByText(/1 missing categories, 0 missing products/)).toBeVisible();
  await expect(page.getByText(/1 mapping conflicts/)).toBeVisible();
  await expect(page.getByLabel('Create Category: Weekend Sides')).toBeVisible();
  await expect(page.getByText('Product: Milkshake — CONFLICT_NAME')).toBeVisible();
  expect(commands).toEqual([
    expect.objectContaining({
      type: 'catalog-copy.missing-preview',
      sourceShopId: copySourceShopId,
      targetShopId: shopId,
      targetDraftId: draftId,
      expectedSourcePublishVersion: 17,
      expectedTargetPublishVersion: 48,
      expectedTargetDraftRevision: 2,
    }),
  ]);
});

test('mobile Catalog Copy stages explicitly selected missing Category without publishing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { commands } = await mockPublishing(page, true);
  await page.goto('/catalog/products/publishing');

  await page.getByRole('button', { name: 'Inspect target master mappings' }).click();
  await page.getByLabel('Create Category: Weekend Sides').check();
  await page.getByRole('button', { name: 'Stage selected new entities in target draft' }).click();

  await expect(page.getByText(/New Catalog entities staged in target draft/)).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toMatchObject({
    type: 'catalog-copy.stage-created-entities',
    sourceShopId: copySourceShopId,
    targetShopId: shopId,
    targetDraftId: draftId,
    selectedSourceCategoryIds: ['11111111-1111-4111-8111-111111111120'],
    selectedSourceProductIds: [],
    creationFingerprint: 'c'.repeat(64),
  });
  expect(commands.every((command) => command.type !== 'draft.publish')).toBe(true);
});

test('Catalog Copy can create an authorized target draft before previewing', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {}, true);
  await page.goto('/catalog/products/publishing');

  await expect(
    page.getByText('Create an authorized catalog draft for this shop before copying.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create target draft for copy' }).click();
  await expect(page.getByRole('button', { name: 'Preview catalog copy' })).toBeVisible();
  expect(commands.find((command) => command.type === 'draft.create')).toMatchObject({
    type: 'draft.create',
    shopId,
    expectedVersion: 48,
  });
});

test('Catalog Copy previews and stages unit-safe master-mapped recipe lines', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {
    selectedDomains: ['recipeLines'],
    changedProducts: 0,
    differences: [],
    mappedRecipeLines: 1,
    changedRecipeLines: 1,
    recipeDifferences: [
      {
        targetProductId: '11111111-1111-4111-8111-111111111112',
        targetInventoryItemId: '11111111-1111-4111-8111-111111111114',
        quantityBeforeMicros: null,
        quantityAfterMicros: 2500000,
      },
    ],
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', {
      name: 'Recipe quantities (explicit inventory masters and matching base units)',
    })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();
  await expect(page.getByText(/1 mapped recipe lines/)).toBeVisible();
  await expect(page.getByText(/2500000/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  expect(commands.find((command) => command.type === 'catalog-copy.preview')).toMatchObject({
    selectedDomains: ['recipeLines'],
  });
  expect(commands.find((command) => command.type === 'catalog-copy.apply')).toMatchObject({
    selectedDomains: ['recipeLines'],
  });
});

test('Catalog Copy previews and stages mapped modifier definitions', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {
    selectedDomains: ['modifierDefinitions'],
    changedProducts: 0,
    differences: [],
    mappedModifierDefinitions: 1,
    changedModifierDefinitions: 1,
    modifierDefinitionDifferences: [
      {
        targetModifierId: '11111111-1111-4111-8111-111111111113',
        nameBefore: 'Target modifier',
        nameAfter: 'Source modifier',
        priceBeforeMinor: 600,
        priceAfterMinor: 500,
        activeBefore: true,
        activeAfter: true,
        sortOrderBefore: 8,
        sortOrderAfter: 3,
      },
    ],
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', {
      name: 'Modifier definitions (mapped names, prices, active status and order)',
    })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();
  await expect(page.getByText(/1 mapped modifier definitions/)).toBeVisible();
  await expect(page.getByText(/Target modifier/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  expect(commands.find((command) => command.type === 'catalog-copy.preview')).toMatchObject({
    selectedDomains: ['modifierDefinitions'],
  });
  expect(commands.find((command) => command.type === 'catalog-copy.apply')).toMatchObject({
    selectedDomains: ['modifierDefinitions'],
  });
});

test('Catalog Copy previews and stages mapped product modifier links', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {
    selectedDomains: ['productModifierLinks'],
    mappedProducts: 3,
    changedProducts: 0,
    differences: [],
    mappedProductModifierLinks: 1,
    changedProductModifierLinks: 1,
    productModifierLinkDifferences: [
      {
        targetProductId: '11111111-1111-4111-8111-111111111112',
        targetModifierId: '11111111-1111-4111-8111-111111111113',
        maxQuantityBefore: null,
        maxQuantityAfter: 2,
        sortOrderBefore: null,
        sortOrderAfter: 6,
      },
    ],
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', {
      name: 'Product modifier links (mapped standalone products only)',
    })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();
  await expect(page.getByText(/1 mapped modifier links/)).toBeVisible();
  await expect(page.getByText(/1 link changes/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  expect(commands.find((command) => command.type === 'catalog-copy.preview')).toMatchObject({
    selectedDomains: ['productModifierLinks'],
  });
  expect(commands.find((command) => command.type === 'catalog-copy.apply')).toMatchObject({
    selectedDomains: ['productModifierLinks'],
  });
});

test('Catalog Copy previews and stages mapped combo beverage options', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {
    selectedDomains: ['comboBeverageOptions'],
    mappedProducts: 3,
    changedProducts: 0,
    differences: [],
    mappedComboBeverageOptions: 1,
    changedComboBeverageOptions: 1,
    comboDifferences: [
      {
        targetComboProductId: '11111111-1111-4111-8111-111111111112',
        targetBeverageProductId: '11111111-1111-4111-8111-111111111113',
        sortOrderBefore: null,
        sortOrderAfter: 11,
      },
    ],
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', { name: 'Combo beverage options (mapped products only)' })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();
  await expect(page.getByText(/1 combo beverage options mapped/)).toBeVisible();
  await expect(page.getByText(/option changes/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  expect(commands.find((command) => command.type === 'catalog-copy.preview')).toMatchObject({
    selectedDomains: ['comboBeverageOptions'],
  });
  expect(commands.find((command) => command.type === 'catalog-copy.apply')).toMatchObject({
    selectedDomains: ['comboBeverageOptions'],
  });
});

test('Catalog Copy remaps product categories before staging', async ({ page }) => {
  const { commands } = await mockPublishing(page, true, {
    selectedDomains: ['productCategoryAssignments'],
    differences: [
      {
        targetProductId: '11111111-1111-4111-8111-111111111111',
        productName: 'Classic Smash',
        categoryIdBefore: 'target-category-before',
        categoryIdAfter: 'target-category-mapped',
      },
    ],
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', {
      name: 'Product category assignments (mapped products and categories)',
    })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();
  await expect(page.getByText(/Category: target-category-before/)).toBeVisible();
  await expect(page.getByText(/target-category-mapped/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply to target draft' }).click();
  expect(commands.find((command) => command.type === 'catalog-copy.preview')).toMatchObject({
    selectedDomains: ['productCategoryAssignments'],
  });
  expect(commands.find((command) => command.type === 'catalog-copy.apply')).toMatchObject({
    selectedDomains: ['productCategoryAssignments'],
  });
});

test('Catalog Copy rejects a preview for another source shop before staging', async ({ page }) => {
  await mockPublishing(page, true, {
    sourceShopId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });
  await page.goto('/catalog/products/publishing');
  await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
  await page
    .getByRole('checkbox', { name: 'Product display order (mapped products only)' })
    .check();
  await page.getByRole('button', { name: 'Preview catalog copy' }).click();

  await expect(page.getByRole('alert')).toContainText('Catalog preview could not be verified.');
  await expect(page.getByRole('button', { name: 'Apply to target draft' })).toHaveCount(0);
});

for (const viewport of ADMIN_WIDE_TABLET_VIEWPORTS) {
  test(`publish review remains usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockPublishing(page);
    await page.goto('/catalog/products/publishing');

    await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore version 47' })).toBeVisible();
    await expect(page.getByText('Automatic scheduling is unavailable')).toBeVisible();
    await expect(page.getByLabel('Activation time (Cairo)')).toHaveCount(0);
  });
}

if (process.env['P02_CAPTURE'] === '1') {
  const widths = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 375, height: 844 },
    { width: 320, height: 720 },
  ] as const;
  for (const viewport of widths) {
    test(`P02 screenshots: catalog publish and copy preview ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await mockPublishing(page, true);
      await page.goto('/catalog/products/publishing');
      await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-publish-${viewport.width}-light.png`,
        fullPage: true,
      });
      await expect(page.getByRole('heading', { name: 'Selective catalog copy' })).toBeVisible();
      await page.getByRole('checkbox', { name: 'Product availability' }).uncheck();
      await page
        .getByRole('checkbox', { name: 'Product display order (mapped products only)' })
        .check();
      await page.getByRole('button', { name: 'Preview catalog copy' }).click();
      await expect(page.getByText('Order: 40 → 5.')).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-copy-preview-${viewport.width}-light.png`,
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({
        path: `artifacts/p02/catalog-copy-preview-${viewport.width}-dark.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
}

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
          schedules: pendingSchedule
            ? [
                {
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
                },
              ]
            : [],
          draftPreviews:
            requestedShop === shop
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
                  changes: [
                    {
                      kind: 'product',
                      id: product,
                      status: 'modified',
                      changedFields: ['name'],
                      before: { name: 'Original' },
                      after: { name: draft.changedName },
                    },
                  ],
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
    get reads() {
      return reads;
    },
    setDrafts(next: Draft[]) {
      drafts = next;
    },
    setVersion(next: number) {
      publishVersion = next;
    },
  };
}

const publishButton = (page: Page) =>
  page.getByRole('button', { name: 'Publish now', exact: true });
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

test('new server revision and changed preview invalidate checked publication before POST', async ({
  page,
}) => {
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

test('selected draft disappearing never falls back to publishing a different draft', async ({
  page,
}) => {
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

test('changed between confirmation and preflight fetch fails closed without POST', async ({
  page,
}) => {
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

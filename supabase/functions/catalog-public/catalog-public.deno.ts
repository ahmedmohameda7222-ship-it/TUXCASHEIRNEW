import { handleCatalogPublicRequest, type PublicCatalogStore } from './catalog.ts';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP_ID = '99999999-9999-4999-8999-999999999999';
const CATEGORY_A = '22222222-2222-4222-8222-222222222222';
const CATEGORY_B = '22222222-2222-4222-8222-222222222223';
const PRODUCT_A = '33333333-3333-4333-8333-333333333333';
const PRODUCT_B = '33333333-3333-4333-8333-333333333334';
const MODIFIER_ID = '44444444-4444-4444-8444-444444444444';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function store(overrides: Partial<PublicCatalogStore> = {}): PublicCatalogStore {
  return {
    getShop: async (shopId) => (shopId === SHOP_ID ? { id: SHOP_ID } : null),
    listCategories: async () => [
      {
        id: CATEGORY_B,
        shop_id: SHOP_ID,
        slug: 'fries',
        name: 'Fries',
        description: null,
        active: true,
        sort_order: 2,
        internal_note: 'never expose',
      },
      {
        id: CATEGORY_A,
        shop_id: SHOP_ID,
        slug: 'burgers',
        name: 'Burgers',
        description: 'Smashed burgers',
        active: true,
        sort_order: 1,
      },
    ],
    listProducts: async () => [
      {
        id: PRODUCT_B,
        shop_id: SHOP_ID,
        category_id: CATEGORY_A,
        slug: 'double',
        name: 'Double',
        description: null,
        price_minor: 24000,
        image_key: null,
        best_seller: false,
        active: false,
        sold_out: true,
        is_combo: false,
        sort_order: 2,
        cost_minor: 1,
      },
      {
        id: PRODUCT_A,
        shop_id: SHOP_ID,
        category_id: CATEGORY_A,
        slug: 'single',
        name: 'Single',
        description: 'Single burger',
        price_minor: 19000,
        image_key: `${SHOP_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`,
        best_seller: true,
        active: true,
        sold_out: false,
        is_combo: false,
        sort_order: 1,
      },
    ],
    listModifiers: async () => [
      {
        id: MODIFIER_ID,
        shop_id: SHOP_ID,
        name: 'Extra cheese',
        price_minor: 2000,
        active: true,
        sort_order: 1,
        standalone_product_id: PRODUCT_B,
      },
    ],
    listProductModifierLinks: async () => [
      {
        shop_id: SHOP_ID,
        product_id: PRODUCT_A,
        modifier_id: MODIFIER_ID,
        max_quantity: 2,
        sort_order: 1,
      },
    ],
    listComboBeverageOptions: async () => [],
    resolveImageUrl: (imageKey) => (imageKey ? `https://images.example.test/${imageKey}` : null),
    ...overrides,
  };
}

function request(shopId = SHOP_ID): Request {
  return new Request(`https://example.test/catalog-public?shopId=${encodeURIComponent(shopId)}`);
}

Deno.test('catalog-public rejects invalid shop UUID', async () => {
  const response = await handleCatalogPublicRequest(request('bad'), store());
  assert(response.status === 400, 'expected 400');
  assert(
    ((await body(response)).error as { code: string }).code === 'invalid_shop_id',
    'wrong code',
  );
});

Deno.test('catalog-public distinguishes unknown shop from empty catalog', async () => {
  const response = await handleCatalogPublicRequest(request(OTHER_SHOP_ID), store());
  assert(response.status === 404, 'expected 404');
  assert(
    ((await body(response)).error as { code: string }).code === 'shop_not_found',
    'wrong code',
  );
});

Deno.test('catalog-public returns a legitimate empty catalog for an existing shop', async () => {
  const empty = store({
    listCategories: async () => [],
    listProducts: async () => [],
    listModifiers: async () => [],
    listProductModifierLinks: async () => [],
    listComboBeverageOptions: async () => [],
  });
  const response = await handleCatalogPublicRequest(request(), empty);
  const payload = await body(response);
  assert(response.status === 200, 'expected 200');
  assert(
    Array.isArray(payload.categories) && payload.categories.length === 0,
    'categories not empty',
  );
  assert(Array.isArray(payload.products) && payload.products.length === 0, 'products not empty');
});

Deno.test('catalog-public backend failure is not converted to an empty catalog', async () => {
  const response = await handleCatalogPublicRequest(
    request(),
    store({
      listProducts: async () => {
        throw new Error('database secret detail');
      },
    }),
  );
  const payload = await body(response);
  assert(response.status === 500, 'expected 500');
  assert((payload.error as { code: string }).code === 'catalog_read_failed', 'wrong code');
  assert(!JSON.stringify(payload).includes('database secret detail'), 'internal error leaked');
});

Deno.test('catalog-public fails closed if a store returns a cross-shop row', async () => {
  const response = await handleCatalogPublicRequest(
    request(),
    store({
      listProducts: async () => [
        {
          id: PRODUCT_A,
          shop_id: OTHER_SHOP_ID,
          category_id: CATEGORY_A,
          slug: 'single',
          name: 'Single',
          description: null,
          price_minor: 19000,
          image_key: null,
          best_seller: false,
          active: true,
          sold_out: false,
          is_combo: false,
          sort_order: 1,
        },
      ],
    }),
  );
  assert(response.status === 500, 'cross-shop row must fail closed');
});

Deno.test('catalog-public emits deterministic ordering and customer-safe fields only', async () => {
  const response = await handleCatalogPublicRequest(request(), store());
  const payload = await body(response);
  assert(response.status === 200, 'expected 200');
  const categories = payload.categories as Array<Record<string, unknown>>;
  const products = payload.products as Array<Record<string, unknown>>;
  const modifiers = payload.modifiers as Array<Record<string, unknown>>;
  assert(
    categories[0]?.id === CATEGORY_A && categories[1]?.id === CATEGORY_B,
    'category ordering unstable',
  );
  assert(
    products[0]?.id === PRODUCT_A && products[1]?.id === PRODUCT_B,
    'product ordering unstable',
  );
  assert(
    products[1]?.active === false && products[1]?.soldOut === true,
    'availability semantics lost',
  );
  assert(modifiers[0]?.standaloneProductId === PRODUCT_B, 'standalone modifier identity lost');
  assert(!('shop_id' in products[0]!) && !('cost_minor' in products[0]!), 'internal fields leaked');
  assert(!('internal_note' in categories[0]!), 'category internal field leaked');
});

Deno.test(
  'catalog-public revision is stable for equivalent projections and changes for public content',
  async () => {
    const first = await body(await handleCatalogPublicRequest(request(), store()));
    const second = await body(await handleCatalogPublicRequest(request(), store()));
    assert(first.revision === second.revision, 'equivalent snapshot revision changed');

    const changed = await body(
      await handleCatalogPublicRequest(
        request(),
        store({
          listProducts: async () => [
            {
              id: PRODUCT_A,
              shop_id: SHOP_ID,
              category_id: CATEGORY_A,
              slug: 'single',
              name: 'Single changed',
              description: 'Single burger',
              price_minor: 19000,
              image_key: null,
              best_seller: true,
              active: true,
              sold_out: false,
              is_combo: false,
              sort_order: 1,
            },
          ],
        }),
      ),
    );
    assert(first.revision !== changed.revision, 'public content change did not change revision');
  },
);

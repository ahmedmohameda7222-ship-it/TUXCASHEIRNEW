import {
  handleOrderIntakeRequest,
  type OnlineOrderCatalogAuthority,
  type OnlineOrderPendingInsert,
  type OnlineOrderStoredRequest,
  type OnlineOrderIntakeStore,
} from '../supabase/functions/order-intake/order-intake.ts';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ADDON_PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
const MODIFIER_ID = '55555555-5555-4555-8555-555555555555';
const ADDON_MODIFIER_ID = '66666666-6666-4666-8666-666666666666';
const COMBO_ID = '77777777-7777-4777-8777-777777777777';
const BEVERAGE_ID = '88888888-8888-4888-8888-888888888888';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function authority(overrides: Partial<OnlineOrderCatalogAuthority> = {}): OnlineOrderCatalogAuthority {
  return {
    shop: { id: SHOP_ID, active: true },
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        name: 'Single Burger',
        priceMinor: 19000,
        active: true,
        soldOut: false,
        isCombo: false,
      },
      {
        id: ADDON_PRODUCT_ID,
        shopId: SHOP_ID,
        name: 'Extra Cheese Product',
        priceMinor: 500,
        active: true,
        soldOut: false,
        isCombo: false,
      },
      {
        id: COMBO_ID,
        shopId: SHOP_ID,
        name: 'Burger Combo',
        priceMinor: 30000,
        active: true,
        soldOut: false,
        isCombo: true,
      },
      {
        id: BEVERAGE_ID,
        shopId: SHOP_ID,
        name: 'Cola',
        priceMinor: 4000,
        active: true,
        soldOut: false,
        isCombo: false,
      },
    ],
    modifiers: [
      {
        id: MODIFIER_ID,
        shopId: SHOP_ID,
        name: 'Extra Patty Sauce',
        priceMinor: 1000,
        active: true,
        standaloneProductId: null,
      },
      {
        id: ADDON_MODIFIER_ID,
        shopId: SHOP_ID,
        name: 'Extra Cheese',
        priceMinor: 500,
        active: true,
        standaloneProductId: ADDON_PRODUCT_ID,
      },
    ],
    productModifierLinks: [
      { productId: PRODUCT_ID, modifierId: MODIFIER_ID, maxQuantity: 2 },
      { productId: PRODUCT_ID, modifierId: ADDON_MODIFIER_ID, maxQuantity: 1 },
    ],
    comboBeverageOptions: [{ comboProductId: COMBO_ID, beverageProductId: BEVERAGE_ID }],
    ...overrides,
  };
}

class MemoryStore implements OnlineOrderIntakeStore {
  readonly rows = new Map<string, OnlineOrderStoredRequest>();
  readonly inserted: OnlineOrderPendingInsert[] = [];

  constructor(readonly catalog: OnlineOrderCatalogAuthority = authority()) {}

  async loadCatalog(shopId: string): Promise<OnlineOrderCatalogAuthority | null> {
    return shopId === SHOP_ID ? this.catalog : null;
  }

  async findByIdempotency(
    shopId: string,
    idempotencyKey: string,
  ): Promise<OnlineOrderStoredRequest | null> {
    return this.rows.get(`${shopId}:${idempotencyKey}`) ?? null;
  }

  async insertPending(record: OnlineOrderPendingInsert): Promise<void> {
    this.inserted.push(record);
    const stored: OnlineOrderStoredRequest = {
      id: record.id,
      shopId: record.shopId,
      idempotencyKey: record.idempotencyKey,
      requestSha256: record.requestSha256,
      status: 'PENDING',
    };
    this.rows.set(`${record.shopId}:${record.idempotencyKey}`, stored);
  }
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    customer: {
      name: 'Ahmed Mohamed',
      phone: '+20 100 123 4567',
      address: 'Nasr City, Cairo',
    },
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'MIXED',
    items: [
      {
        productId: PRODUCT_ID,
        quantity: 2,
        addonProductIds: [ADDON_PRODUCT_ID],
        modifierSelections: [{ modifierId: MODIFIER_ID, quantity: 2 }],
        comboBeverageProductId: null,
        note: 'No onions',
      },
    ],
    orderNote: 'Call on arrival',
    ...overrides,
  };
}

function request(body: unknown = payload(), method = 'POST', headers: HeadersInit = {}): Request {
  return new Request('https://example.test/order-intake', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function errorCode(body: Record<string, unknown>): string {
  return ((body.error as { code?: unknown } | undefined)?.code ?? '') as string;
}

Deno.test('order-intake accepts POST only and enforces bounded request bodies', async () => {
  const store = new MemoryStore();
  const methodResponse = await handleOrderIntakeRequest(request(undefined, 'GET'), store);
  assert(methodResponse.status === 405, 'GET must be rejected');

  const oversized = await handleOrderIntakeRequest(
    request(payload(), 'POST', { 'content-length': '70000' }),
    store,
  );
  assert(oversized.status === 413, 'oversized request must be rejected');
  assert(errorCode(await json(oversized)) === 'payload_too_large', 'wrong oversized code');
});

Deno.test('order-intake rejects client-authoritative money before persistence', async () => {
  const store = new MemoryStore();
  const response = await handleOrderIntakeRequest(
    request({ ...payload(), totalMinor: 1, deliveryFeeMinor: 0 }),
    store,
  );
  assert(response.status === 400, 'client total must be rejected');
  assert(errorCode(await json(response)) === 'invalid_request', 'wrong validation code');
  assert(store.inserted.length === 0, 'invalid request reached persistence');
});

Deno.test('order-intake computes trusted pricing and normalizes delivery phone server-side', async () => {
  const store = new MemoryStore();
  const response = await handleOrderIntakeRequest(request(), store);
  const responseBody = await json(response);
  assert(response.status === 202, 'valid intake must return 202');
  assert(responseBody.status === 'PENDING', 'valid intake must remain pending');
  assert(typeof responseBody.requestId === 'string', 'request id missing');
  assert(Object.keys(responseBody).sort().join(',') === 'requestId,schemaVersion,status', 'response leaked authority');
  assert(store.inserted.length === 1, 'pending request was not persisted once');

  const inserted = store.inserted[0]!;
  assert(inserted.normalizedPhone === '01001234567', 'Egyptian phone was not canonicalized');
  assert(inserted.itemsSubtotalMinor === 43000, 'trusted subtotal was not recomputed');
  assert(inserted.paymentPreference === 'MIXED', 'payment preference intent was lost');
  assert(inserted.status === 'PENDING', 'browser intake created a final order');
  assert(inserted.acceptedOrderId === null, 'browser intake invented a final order id');

  const trustedItems = inserted.trustedItems as Array<Record<string, unknown>>;
  const first = trustedItems[0]!;
  assert(first.productId === PRODUCT_ID, 'trusted product identity changed');
  assert(first.productName === 'Single Burger', 'trusted product name not snapshotted');
  assert(first.unitPriceMinor === 19000, 'trusted unit price not snapshotted');
  const modifiers = first.modifiers as Array<Record<string, unknown>>;
  assert(modifiers.length === 2, 'canonical direct/addon modifiers were not snapshotted');
  assert(!JSON.stringify(inserted).includes('Extra Cheese Product'), 'addon product was materialized as an order line');
});

Deno.test('order-intake rejects inactive or sold-out requested products', async () => {
  const unavailable = authority({
    products: authority().products.map((product) =>
      product.id === PRODUCT_ID ? { ...product, soldOut: true } : product,
    ),
  });
  const store = new MemoryStore(unavailable);
  const response = await handleOrderIntakeRequest(request(), store);
  assert(response.status === 409, 'sold-out product must conflict');
  assert(errorCode(await json(response)) === 'item_unavailable', 'wrong sold-out code');
  assert(store.inserted.length === 0, 'sold-out request persisted');
});

Deno.test('order-intake validates modifier links and maximum quantities', async () => {
  const unlinked = new MemoryStore(authority({ productModifierLinks: [] }));
  const unlinkedResponse = await handleOrderIntakeRequest(request(), unlinked);
  assert(unlinkedResponse.status === 400, 'unlinked modifier must be rejected');
  assert(errorCode(await json(unlinkedResponse)) === 'invalid_selection', 'wrong unlinked code');

  const tooMany = payload();
  const items = tooMany.items as Array<Record<string, unknown>>;
  items[0] = {
    ...items[0],
    addonProductIds: [],
    modifierSelections: [{ modifierId: MODIFIER_ID, quantity: 3 }],
  };
  const maxResponse = await handleOrderIntakeRequest(request(tooMany), new MemoryStore());
  assert(maxResponse.status === 400, 'modifier max quantity must be enforced');
  assert(errorCode(await json(maxResponse)) === 'invalid_selection', 'wrong max-quantity code');
});

Deno.test('order-intake accepts addon products only through linked standalone modifiers', async () => {
  const brokenAddon = authority({
    modifiers: authority().modifiers.map((modifier) =>
      modifier.id === ADDON_MODIFIER_ID ? { ...modifier, standaloneProductId: null } : modifier,
    ),
  });
  const response = await handleOrderIntakeRequest(request(), new MemoryStore(brokenAddon));
  assert(response.status === 400, 'unmapped addon product must be rejected');
  assert(errorCode(await json(response)) === 'invalid_selection', 'wrong addon mapping code');
});

Deno.test('order-intake validates combo beverage relationships without charging beverage retail price', async () => {
  const comboPayload = payload({
    items: [
      {
        productId: COMBO_ID,
        quantity: 1,
        addonProductIds: [],
        modifierSelections: [],
        comboBeverageProductId: BEVERAGE_ID,
        note: null,
      },
    ],
  });
  const validStore = new MemoryStore();
  const valid = await handleOrderIntakeRequest(request(comboPayload), validStore);
  assert(valid.status === 202, 'valid combo beverage must be accepted');
  assert(validStore.inserted[0]?.itemsSubtotalMinor === 30000, 'combo beverage retail price was added');

  const invalidStore = new MemoryStore(authority({ comboBeverageOptions: [] }));
  const invalid = await handleOrderIntakeRequest(request(comboPayload), invalidStore);
  assert(invalid.status === 400, 'unlinked combo beverage must be rejected');
  assert(errorCode(await json(invalid)) === 'invalid_selection', 'wrong combo relationship code');
});

Deno.test('order-intake replays an equivalent canonical request and conflicts on idempotency reuse', async () => {
  const store = new MemoryStore();
  const first = await handleOrderIntakeRequest(request(), store);
  const firstBody = await json(first);
  assert(first.status === 202, 'first intake failed');

  const equivalent = payload();
  equivalent.customer = {
    name: 'Ahmed Mohamed',
    phone: '01001234567',
    address: 'Nasr City, Cairo',
  };
  const replay = await handleOrderIntakeRequest(request(equivalent), store);
  const replayBody = await json(replay);
  assert(replay.status === 200, 'equivalent retry must replay');
  assert(replayBody.requestId === firstBody.requestId, 'retry changed request identity');
  assert(store.inserted.length === 1, 'retry duplicated pending request');

  const conflict = await handleOrderIntakeRequest(
    request(payload({ orderNote: 'Different request with same key' })),
    store,
  );
  assert(conflict.status === 409, 'different payload reused idempotency key');
  assert(errorCode(await json(conflict)) === 'idempotency_conflict', 'wrong conflict code');
});

Deno.test('order-intake rejects invalid delivery phone and fails closed on cross-shop authority', async () => {
  const badPhone = payload();
  badPhone.customer = { name: 'Ahmed', phone: '+4912345', address: 'Cairo' };
  const badPhoneResponse = await handleOrderIntakeRequest(request(badPhone), new MemoryStore());
  assert(badPhoneResponse.status === 400, 'invalid Egyptian delivery phone must be rejected');
  assert(errorCode(await json(badPhoneResponse)) === 'invalid_phone', 'wrong phone code');

  const crossShop = authority({
    products: authority().products.map((product, index) =>
      index === 0 ? { ...product, shopId: '99999999-9999-4999-8999-999999999999' } : product,
    ),
  });
  const crossShopResponse = await handleOrderIntakeRequest(request(), new MemoryStore(crossShop));
  assert(crossShopResponse.status === 500, 'cross-shop authority must fail closed');
  assert(errorCode(await json(crossShopResponse)) === 'intake_failed', 'wrong cross-shop code');
});

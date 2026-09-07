import {
  handleCatalogAdminRequest,
  type CatalogAdminDependencies,
  type CatalogAdminStore,
} from './catalogAdmin.ts';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const MODIFIER_ID = '44444444-4444-4444-8444-444444444444';
const COMMAND_ID = '55555555-5555-4555-8555-555555555555';
const IMAGE_ID = '66666666-6666-4666-8666-666666666666';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function code(payload: Record<string, unknown>): string | undefined {
  return (payload.error as { code?: string } | undefined)?.code;
}

class FakeStore implements CatalogAdminStore {
  membership: { role: 'OWNER' | 'ADMIN' | 'OPERATIONS_DEVICE'; active: boolean } | null = {
    role: 'ADMIN',
    active: true,
  };
  entityShops = new Map<string, string>([
    [`category:${CATEGORY_ID}`, SHOP_ID],
    [`product:${PRODUCT_ID}`, SHOP_ID],
    [`modifier:${MODIFIER_ID}`, SHOP_ID],
  ]);
  imageExists = true;
  imageReferences = 0;
  removedImages: string[] = [];
  applied: Array<Record<string, unknown>> = [];
  applyResult: Awaited<ReturnType<CatalogAdminStore['applyAtomicCommand']>> = {
    ok: true,
    result: { status: 'applied' },
  };

  async getMembership() { return this.membership; }
  async getEntityShop(entity: 'category' | 'product' | 'modifier', id: string) {
    return this.entityShops.get(`${entity}:${id}`) ?? null;
  }
  async applyAtomicCommand(_userId: string, request: Parameters<CatalogAdminStore['applyAtomicCommand']>[1]) {
    this.applied.push(request as unknown as Record<string, unknown>);
    return this.applyResult;
  }
  async createSignedImageUpload(imageKey: string) {
    return { signedUrl: `https://upload.example.test/${imageKey}`, token: 'signed-token' };
  }
  async imageObjectExists() { return this.imageExists; }
  async countImageReferences() { return this.imageReferences; }
  async removeImageObject(imageKey: string) { this.removedImages.push(imageKey); }
}

function deps(store = new FakeStore()): CatalogAdminDependencies {
  return {
    authenticate: async (token) => token === 'valid-token' ? USER_ID : null,
    store,
  };
}

function command(
  payload: Record<string, unknown>,
  options: { token?: string; shopId?: string; commandId?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  return new Request('https://example.test/catalog-admin', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      schemaVersion: 1,
      shopId: options.shopId ?? SHOP_ID,
      commandId: options.commandId ?? COMMAND_ID,
      command: payload,
    }),
  });
}

Deno.test('catalog-admin rejects missing bearer token', async () => {
  const response = await handleCatalogAdminRequest(command({ type: 'product.retire', productId: PRODUCT_ID }), deps());
  assert(response.status === 401, 'expected 401');
  assert(code(await json(response)) === 'authentication_required', 'wrong code');
});

Deno.test('catalog-admin rejects invalid JWT identity', async () => {
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'bad-token' }),
    deps(),
  );
  assert(response.status === 401, 'expected 401');
  assert(code(await json(response)) === 'invalid_identity', 'wrong code');
});

Deno.test('catalog-admin rejects no membership', async () => {
  const store = new FakeStore(); store.membership = null;
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token' }), deps(store),
  );
  assert(response.status === 403, 'expected 403');
  assert(code(await json(response)) === 'membership_required', 'wrong code');
});

Deno.test('catalog-admin rejects inactive membership', async () => {
  const store = new FakeStore(); store.membership = { role: 'OWNER', active: false };
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token' }), deps(store),
  );
  assert(response.status === 403, 'expected 403');
  assert(code(await json(response)) === 'membership_inactive', 'wrong code');
});

Deno.test('catalog-admin rejects OPERATIONS_DEVICE membership', async () => {
  const store = new FakeStore(); store.membership = { role: 'OPERATIONS_DEVICE', active: true };
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token' }), deps(store),
  );
  assert(response.status === 403, 'expected 403');
  assert(code(await json(response)) === 'role_forbidden', 'wrong code');
});

Deno.test('catalog-admin allows ADMIN and OWNER', async () => {
  for (const role of ['ADMIN', 'OWNER'] as const) {
    const store = new FakeStore(); store.membership = { role, active: true };
    const response = await handleCatalogAdminRequest(
      command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token' }), deps(store),
    );
    assert(response.status === 200, `${role} was rejected`);
  }
});

Deno.test('catalog-admin rejects role spoofing even when database role is ADMIN', async () => {
  const response = await handleCatalogAdminRequest(
    new Request('https://example.test/catalog-admin', {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1, shopId: SHOP_ID, commandId: COMMAND_ID, role: 'OWNER',
        command: { type: 'product.retire', productId: PRODUCT_ID },
      }),
    }),
    deps(),
  );
  assert(response.status === 400, 'spoofed role must be invalid request');
});

Deno.test('catalog-admin rejects membership in a different shop', async () => {
  const store = new FakeStore(); store.membership = null;
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token', shopId: OTHER_SHOP_ID }),
    deps(store),
  );
  assert(response.status === 403, 'expected 403');
  assert(code(await json(response)) === 'membership_required', 'wrong code');
});

Deno.test('catalog-admin rejects cross-shop entity mutation', async () => {
  const store = new FakeStore(); store.entityShops.set(`product:${PRODUCT_ID}`, OTHER_SHOP_ID);
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.update', productId: PRODUCT_ID, patch: { priceMinor: 20000 } }, { token: 'valid-token' }),
    deps(store),
  );
  assert(response.status === 403, 'expected 403');
  assert(code(await json(response)) === 'cross_shop_forbidden', 'wrong code');
  assert(store.applied.length === 0, 'cross-shop mutation reached atomic store');
});

Deno.test('catalog-admin covers category create/update/retire/reorder through atomic commands', async () => {
  for (const payload of [
    { type: 'category.create', category: { id: '77777777-7777-4777-8777-777777777777', slug: 'new-category', name: 'New', description: null, active: true, sortOrder: 7 } },
    { type: 'category.update', categoryId: CATEGORY_ID, patch: { description: 'Updated' } },
    { type: 'category.retire', categoryId: CATEGORY_ID },
    { type: 'category.reorder', categoryId: CATEGORY_ID, sortOrder: 9 },
  ]) {
    const store = new FakeStore();
    const response = await handleCatalogAdminRequest(command(payload, { token: 'valid-token' }), deps(store));
    assert(response.status === 200, `${payload.type} rejected`);
    assert(store.applied.length === 1, `${payload.type} was not atomic-store backed`);
  }
});

Deno.test('catalog-admin covers product create/update/move/retire/reorder and canonical flags', async () => {
  const newProductId = '88888888-8888-4888-8888-888888888888';
  for (const payload of [
    { type: 'product.create', product: { id: newProductId, categoryId: CATEGORY_ID, slug: 'new-product', name: 'New', description: null, priceMinor: 19000, imageKey: null, bestSeller: false, active: true, soldOut: false, isCombo: false, sortOrder: 1 } },
    { type: 'product.update', productId: PRODUCT_ID, patch: { description: 'Updated', priceMinor: 20000, active: false, soldOut: true, bestSeller: true, sortOrder: 3 } },
    { type: 'product.move', productId: PRODUCT_ID, categoryId: CATEGORY_ID },
    { type: 'product.retire', productId: PRODUCT_ID },
    { type: 'product.reorder', productId: PRODUCT_ID, sortOrder: 8 },
  ]) {
    const store = new FakeStore();
    const response = await handleCatalogAdminRequest(command(payload, { token: 'valid-token' }), deps(store));
    assert(response.status === 200, `${payload.type} rejected`);
    assert(store.applied.length === 1, `${payload.type} was not atomic-store backed`);
  }
});

Deno.test('catalog-admin supports modifier and combo/link canonical mutation commands', async () => {
  for (const payload of [
    { type: 'modifier.update', modifierId: MODIFIER_ID, patch: { priceMinor: 2500 } },
    { type: 'product_modifier_link.set', productId: PRODUCT_ID, modifierId: MODIFIER_ID, maxQuantity: 2, sortOrder: 1 },
    { type: 'product_modifier_link.remove', productId: PRODUCT_ID, modifierId: MODIFIER_ID },
    { type: 'combo_beverage_option.set', comboProductId: PRODUCT_ID, beverageProductId: PRODUCT_ID, sortOrder: 1 },
  ]) {
    const store = new FakeStore();
    const response = await handleCatalogAdminRequest(command(payload, { token: 'valid-token' }), deps(store));
    if (payload.type === 'combo_beverage_option.set') {
      assert(response.status === 400, 'same product combo/beverage must fail validation');
    } else {
      assert(response.status === 200, `${payload.type} rejected`);
    }
  }
});

Deno.test('catalog-admin prepares only shop-scoped image keys derived from command identity', async () => {
  const store = new FakeStore();
  const response = await handleCatalogAdminRequest(
    command({ type: 'image.prepare', productId: PRODUCT_ID, fileExtension: 'webp', contentType: 'image/webp' }, { token: 'valid-token', commandId: IMAGE_ID }),
    deps(store),
  );
  const payload = await json(response);
  const result = payload.result as { imageKey: string };
  assert(response.status === 200, 'image prepare failed');
  assert(result.imageKey === `${SHOP_ID}/${IMAGE_ID}.webp`, 'image key is not deterministic/shop-scoped');
});

Deno.test('catalog-admin rejects cross-shop image keys', async () => {
  const store = new FakeStore();
  const response = await handleCatalogAdminRequest(
    command({ type: 'image.replace', productId: PRODUCT_ID, imageKey: `${OTHER_SHOP_ID}/${IMAGE_ID}.webp` }, { token: 'valid-token' }),
    deps(store),
  );
  assert(response.status === 403, 'cross-shop image key accepted');
  assert(code(await json(response)) === 'image_key_forbidden', 'wrong image error');
});

Deno.test('catalog-admin rejects replacement with an object that does not exist', async () => {
  const store = new FakeStore(); store.imageExists = false;
  const response = await handleCatalogAdminRequest(
    command({ type: 'image.replace', productId: PRODUCT_ID, imageKey: `${SHOP_ID}/${IMAGE_ID}.webp` }, { token: 'valid-token' }),
    deps(store),
  );
  assert(response.status === 400, 'missing upload accepted');
  assert(code(await json(response)) === 'invalid_request', 'wrong code');
});

Deno.test('catalog-admin image replacement cleans an unreferenced previous key after DB ownership moves', async () => {
  const store = new FakeStore();
  store.applyResult = { ok: true, result: { imageKey: `${SHOP_ID}/${IMAGE_ID}.webp`, previousImageKey: `${SHOP_ID}/77777777-7777-4777-8777-777777777777.webp` } };
  const response = await handleCatalogAdminRequest(
    command({ type: 'image.replace', productId: PRODUCT_ID, imageKey: `${SHOP_ID}/${IMAGE_ID}.webp` }, { token: 'valid-token' }),
    deps(store),
  );
  assert(response.status === 200, 'replace failed');
  assert(store.removedImages.length === 1, 'unreferenced old image not cleaned up');
});

Deno.test('catalog-admin retire semantics are server commands, never hard-delete browser CRUD', async () => {
  const store = new FakeStore();
  const response = await handleCatalogAdminRequest(
    command({ type: 'product.retire', productId: PRODUCT_ID }, { token: 'valid-token' }), deps(store),
  );
  const payload = await json(response);
  assert(response.status === 200, 'retire failed');
  assert(payload.ok === true && payload.schemaVersion === 1 && payload.commandId === COMMAND_ID, 'result contract invalid');
  assert((store.applied[0]?.command as { type?: string }).type === 'product.retire', 'retire command changed');
});

import {
  readJsonBody,
  requireDeviceSession,
  requireSameOrigin,
  requireServerConfig,
  sendJson,
  type GatewayRequest,
  type GatewayResponse,
} from './supabaseGateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const MAX_CATEGORIES = 256;
const MAX_PRODUCTS = 4096;
const MAX_PAYLOAD_CHARS = 262_144;

interface WorkerMenuLayoutInput {
  readonly shopId: string;
  readonly workerId: string;
  readonly categoryOrder: readonly string[];
  readonly categoryAlignment: 'left' | 'center' | 'right';
  readonly productOrderByCategory: Readonly<Record<string, readonly string[]>>;
  readonly expectedLayoutVersion: number | null;
}

interface RemoteWorkerMenuLayout {
  readonly shopId: string;
  readonly workerId: string;
  readonly categoryOrder: readonly string[];
  readonly categoryAlignment: 'left' | 'center' | 'right';
  readonly productOrderByCategory: Readonly<Record<string, readonly string[]>>;
  readonly layoutVersion: number;
  readonly updatedAt: string;
}

function requiredUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function parseIdOrder(value: unknown, limit: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    const id = requiredUuid(rawId);
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    parsed.push(id);
  }
  return parsed;
}

function parseProductOrderByCategory(
  value: unknown,
): Readonly<Record<string, readonly string[]>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > MAX_PAYLOAD_CHARS) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CATEGORIES) return null;
  const parsed: Record<string, readonly string[]> = {};
  const globalProducts = new Set<string>();
  let productCount = 0;
  for (const [rawCategoryId, rawProducts] of entries) {
    const categoryId = requiredUuid(rawCategoryId);
    const products = parseIdOrder(rawProducts, MAX_PRODUCTS);
    if (categoryId === null || products === null) return null;
    productCount += products.length;
    if (productCount > MAX_PRODUCTS) return null;
    for (const productId of products) {
      if (globalProducts.has(productId)) return null;
      globalProducts.add(productId);
    }
    parsed[categoryId] = products;
  }
  return parsed;
}

function parseExpectedVersion(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

function parseInput(value: Readonly<Record<string, unknown>>): WorkerMenuLayoutInput | null {
  const shopId = requiredUuid(value['shopId']);
  const workerId = requiredUuid(value['workerId']);
  const categoryOrder = parseIdOrder(value['categoryOrder'], MAX_CATEGORIES);
  const categoryAlignment = value['categoryAlignment'];
  const productOrderByCategory = parseProductOrderByCategory(value['productOrderByCategory']);
  const expectedLayoutVersion = parseExpectedVersion(value['expectedLayoutVersion']);
  if (
    shopId === null ||
    workerId === null ||
    categoryOrder === null ||
    productOrderByCategory === null ||
    expectedLayoutVersion === undefined ||
    typeof categoryAlignment !== 'string' ||
    !ALIGNMENTS.has(categoryAlignment)
  ) {
    return null;
  }
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: categoryAlignment as WorkerMenuLayoutInput['categoryAlignment'],
    productOrderByCategory,
    expectedLayoutVersion,
  };
}

function parseRemoteRow(value: unknown): RemoteWorkerMenuLayout | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const shopId = requiredUuid(row['shop_id']);
  const workerId = requiredUuid(row['worker_id']);
  const categoryOrder = parseIdOrder(row['category_order'], MAX_CATEGORIES);
  const categoryAlignment = row['category_alignment'];
  const productOrderByCategory = parseProductOrderByCategory(row['product_order_by_category']);
  const layoutVersion = row['layout_version'];
  const updatedAt = row['updated_at'];
  if (
    shopId === null ||
    workerId === null ||
    categoryOrder === null ||
    productOrderByCategory === null ||
    typeof categoryAlignment !== 'string' ||
    !ALIGNMENTS.has(categoryAlignment) ||
    typeof layoutVersion !== 'number' ||
    !Number.isSafeInteger(layoutVersion) ||
    layoutVersion < 1 ||
    typeof updatedAt !== 'string' ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    return null;
  }
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: categoryAlignment as RemoteWorkerMenuLayout['categoryAlignment'],
    productOrderByCategory,
    layoutVersion,
    updatedAt,
  };
}

function upstreamHeaders(input: {
  readonly publishableKey: string;
  readonly accessToken: string;
  readonly deviceId: string;
  readonly hasBody?: boolean;
}): Record<string, string> {
  return {
    apikey: input.publishableKey,
    authorization: `Bearer ${input.accessToken}`,
    'x-tux-device-id': input.deviceId,
    accept: 'application/json',
    ...(input.hasBody === true ? { 'content-type': 'application/json' } : {}),
  };
}

function sendUpstreamError(response: GatewayResponse, status: number, detail: string): void {
  if (detail.includes('TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT')) {
    sendJson(response, 409, { error: 'worker_menu_layout_version_conflict' });
    return;
  }
  if (status === 401) {
    sendJson(response, 401, { error: 'device_authentication_required' });
    return;
  }
  if (status === 403 || detail.includes('TUX_WORKER_MENU_LAYOUT_UNAUTHORIZED')) {
    sendJson(response, 403, { error: 'worker_menu_layout_forbidden' });
    return;
  }
  if (detail.includes('TUX_WORKER_MENU_LAYOUT_')) {
    sendJson(response, 400, { error: 'invalid_worker_menu_layout' });
    return;
  }
  sendJson(response, 502, { error: 'worker_menu_layout_remote_failed' });
}

export async function handleWorkerMenuLayout(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (request.method === 'PUT' && !requireSameOrigin(request, response)) return;

  const config = requireServerConfig(response);
  if (config === null) return;
  const session = await requireDeviceSession(request, response, config);
  if (session === null) return;

  let input: WorkerMenuLayoutInput | null = null;
  if (request.method === 'GET') {
    const url = new URL(request.url ?? '/', 'https://tux.invalid');
    const shopId = requiredUuid(url.searchParams.get('shopId'));
    const workerId = requiredUuid(url.searchParams.get('workerId'));
    if (shopId !== null && workerId !== null) {
      input = {
        shopId,
        workerId,
        categoryOrder: [],
        categoryAlignment: 'left',
        productOrderByCategory: {},
        expectedLayoutVersion: null,
      };
    }
  } else {
    try {
      input = parseInput(await readJsonBody(request));
    } catch {
      input = null;
    }
  }

  if (input === null) {
    sendJson(response, 400, { error: 'invalid_worker_menu_layout_request' });
    return;
  }
  if (input.shopId !== session.shopId) {
    sendJson(response, 403, { error: 'worker_menu_layout_cross_shop' });
    return;
  }

  let upstream: Response;
  try {
    if (request.method === 'GET') {
      const target = new URL(`${config.projectUrl}/rest/v1/worker_menu_layouts`);
      target.searchParams.set('shop_id', `eq.${input.shopId}`);
      target.searchParams.set('worker_id', `eq.${input.workerId}`);
      target.searchParams.set(
        'select',
        'shop_id,worker_id,category_order,category_alignment,product_order_by_category,layout_version,updated_at',
      );
      target.searchParams.set('limit', '1');
      upstream = await fetch(target, {
        method: 'GET',
        headers: upstreamHeaders({
          publishableKey: config.publishableKey,
          accessToken: session.accessToken,
          deviceId: session.deviceId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } else {
      upstream = await fetch(`${config.projectUrl}/rest/v1/rpc/put_worker_menu_layout_v2`, {
        method: 'POST',
        headers: upstreamHeaders({
          publishableKey: config.publishableKey,
          accessToken: session.accessToken,
          deviceId: session.deviceId,
          hasBody: true,
        }),
        body: JSON.stringify({
          p_shop_id: input.shopId,
          p_worker_id: input.workerId,
          p_category_order: input.categoryOrder,
          p_category_alignment: input.categoryAlignment,
          p_product_order_by_category: input.productOrderByCategory,
          p_expected_layout_version: input.expectedLayoutVersion,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = await upstream.text();
    } catch {
      detail = '';
    }
    sendUpstreamError(response, upstream.status, detail);
    return;
  }

  let parsed: unknown;
  try {
    parsed = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }
  if (request.method === 'GET' && Array.isArray(parsed) && parsed.length === 0) {
    sendJson(response, 404, { status: 'NOT_FOUND' });
    return;
  }
  const layout =
    Array.isArray(parsed) && parsed.length === 1 ? parseRemoteRow(parsed[0]) : parseRemoteRow(parsed);
  if (layout === null) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  sendJson(response, 200, layout);
}

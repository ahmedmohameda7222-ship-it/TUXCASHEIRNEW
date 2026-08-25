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

interface WorkerUiPreferenceInput {
  readonly shopId: string;
  readonly workerId: string;
  readonly categoryOrder: readonly string[];
  readonly categoryAlignment: 'left' | 'center' | 'right';
}

interface RemoteWorkerUiPreference {
  readonly shopId: string;
  readonly workerId: string;
  readonly categoryOrder: readonly string[];
  readonly categoryAlignment: 'left' | 'center' | 'right';
  readonly serverVersion: number;
  readonly updatedAt: string;
}

function requiredUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function parseCategoryOrder(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: string[] = [];
  for (const categoryId of value) {
    const id = requiredUuid(categoryId);
    if (id === null || parsed.includes(id)) return null;
    parsed.push(id);
  }
  return parsed;
}

function parseInput(value: Readonly<Record<string, unknown>>): WorkerUiPreferenceInput | null {
  const shopId = requiredUuid(value['shopId']);
  const workerId = requiredUuid(value['workerId']);
  const categoryOrder = parseCategoryOrder(value['categoryOrder']);
  const categoryAlignment = value['categoryAlignment'];
  if (
    shopId === null ||
    workerId === null ||
    categoryOrder === null ||
    typeof categoryAlignment !== 'string' ||
    !ALIGNMENTS.has(categoryAlignment)
  ) {
    return null;
  }
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: categoryAlignment as WorkerUiPreferenceInput['categoryAlignment'],
  };
}

function parseRemoteRow(value: unknown): RemoteWorkerUiPreference | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const shopId = requiredUuid(row['shop_id']);
  const workerId = requiredUuid(row['worker_id']);
  const categoryOrder = parseCategoryOrder(row['category_order']);
  const categoryAlignment = row['category_alignment'];
  const serverVersion = row['server_version'];
  const updatedAt = row['updated_at'];
  if (
    shopId === null ||
    workerId === null ||
    categoryOrder === null ||
    typeof categoryAlignment !== 'string' ||
    !ALIGNMENTS.has(categoryAlignment) ||
    typeof serverVersion !== 'number' ||
    !Number.isSafeInteger(serverVersion) ||
    serverVersion < 1 ||
    typeof updatedAt !== 'string' ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    return null;
  }
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: categoryAlignment as RemoteWorkerUiPreference['categoryAlignment'],
    serverVersion,
    updatedAt,
  };
}

async function parseSingleRemoteRow(upstream: Response): Promise<RemoteWorkerUiPreference | null> {
  let parsed: unknown;
  try {
    parsed = await upstream.json();
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  return parseRemoteRow(parsed[0]);
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

function sendUpstreamError(response: GatewayResponse, status: number): void {
  if (status === 401) {
    sendJson(response, 401, { error: 'device_authentication_required' });
    return;
  }
  if (status === 403) {
    sendJson(response, 403, { error: 'worker_ui_preferences_forbidden' });
    return;
  }
  sendJson(response, 502, { error: 'worker_ui_preferences_remote_failed' });
}

export async function handleWorkerUiPreferences(
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

  let input: WorkerUiPreferenceInput | null = null;
  if (request.method === 'GET') {
    const url = new URL(request.url ?? '/', 'https://tux.invalid');
    const shopId = requiredUuid(url.searchParams.get('shopId'));
    const workerId = requiredUuid(url.searchParams.get('workerId'));
    if (shopId !== null && workerId !== null) {
      input = { shopId, workerId, categoryOrder: [], categoryAlignment: 'center' };
    }
  } else {
    try {
      input = parseInput(await readJsonBody(request));
    } catch {
      input = null;
    }
  }

  if (input === null) {
    sendJson(response, 400, { error: 'invalid_worker_ui_preferences_request' });
    return;
  }
  if (input.shopId !== session.shopId) {
    sendJson(response, 403, { error: 'worker_ui_preferences_cross_shop' });
    return;
  }

  let upstream: Response;
  try {
    if (request.method === 'GET') {
      const target = new URL(`${config.projectUrl}/rest/v1/worker_ui_preferences`);
      target.searchParams.set('shop_id', `eq.${input.shopId}`);
      target.searchParams.set('worker_id', `eq.${input.workerId}`);
      target.searchParams.set(
        'select',
        'shop_id,worker_id,category_order,category_alignment,server_version,updated_at',
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
      upstream = await fetch(`${config.projectUrl}/rest/v1/rpc/put_worker_ui_preferences`, {
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
        }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  if (!upstream.ok) {
    sendUpstreamError(response, upstream.status);
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
  const preference =
    Array.isArray(parsed) && parsed.length === 1 ? parseRemoteRow(parsed[0]) : parseRemoteRow(parsed);
  if (preference === null) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  sendJson(response, 200, preference);
}

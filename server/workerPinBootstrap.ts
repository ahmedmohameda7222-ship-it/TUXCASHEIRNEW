import { createHash } from 'node:crypto';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { readJsonBody, requireSameOrigin, requireServerConfig, sendJson } from './supabaseGateway';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_ACCESS = 'tux_ops_access';
const COOKIE_REFRESH = 'tux_ops_refresh';
const COOKIE_SHOP = 'tux_ops_shop';
const COOKIE_DEVICE = 'tux_ops_device';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function cookie(name: string, value: string, maxAge = COOKIE_MAX_AGE_SECONDS): string {
  return `${name}=${encodeURIComponent(value)}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function persistSession(
  response: GatewayResponse,
  session: {
    readonly shopId: string;
    readonly deviceId: string;
    readonly accessToken: string;
    readonly refreshToken: string;
  },
  expiresAt: number | null,
): void {
  const now = Math.floor(Date.now() / 1000);
  const accessMaxAge =
    expiresAt !== null && Number.isSafeInteger(expiresAt) && expiresAt > now
      ? Math.max(60, Math.min(COOKIE_MAX_AGE_SECONDS, expiresAt - now))
      : 60 * 60;
  response.setHeader('set-cookie', [
    cookie(COOKIE_ACCESS, session.accessToken, accessMaxAge),
    cookie(COOKIE_REFRESH, session.refreshToken),
    cookie(COOKIE_SHOP, session.shopId),
    cookie(COOKIE_DEVICE, session.deviceId),
  ]);
}

function trustedClientAddress(request: GatewayRequest): string {
  // Vercel injects x-vercel-forwarded-for at the deployment boundary. Unlike request-body IDs,
  // User-Agent, or arbitrary client headers, this value represents the public request source at
  // the trusted proxy. If the deployment header is unexpectedly absent, deliberately collapse
  // traffic into one conservative bucket rather than accepting a spoofable fallback identity.
  return (
    firstHeader(request.headers['x-vercel-forwarded-for']).split(',')[0]?.trim() ||
    'unresolved-vercel-client'
  );
}

function rateLimitKey(request: GatewayRequest): string {
  return createHash('sha256')
    .update(`tux-worker-pin-bootstrap:v2\n${trustedClientAddress(request)}`)
    .digest('hex');
}

function safeObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function bootstrapDeviceWithWorkerPin(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const config = requireServerConfig(response);
  if (config === null || !requireSameOrigin(request, response)) return;

  let body: Readonly<Record<string, unknown>>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid_bootstrap_request' });
    return;
  }

  const pin = requiredString(body['pin']);
  const deviceId = requiredString(body['deviceId']);
  const deviceLabel =
    typeof body['deviceLabel'] === 'string' ? body['deviceLabel'].trim().slice(0, 120) : '';
  if (
    pin === null ||
    !/^\d{4,12}$/.test(pin) ||
    deviceId === null ||
    !UUID_PATTERN.test(deviceId)
  ) {
    sendJson(response, 400, { error: 'invalid_bootstrap_request' });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.projectUrl}/functions/v1/device-bootstrap`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pin,
        deviceId,
        deviceLabel,
        rateLimitKey: rateLimitKey(request),
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  if (!upstream.ok) {
    if (upstream.status === 401) {
      sendJson(response, 401, { error: 'invalid_pin' });
      return;
    }
    if (upstream.status === 429) {
      const retryAfter = upstream.headers.get('retry-after');
      if (retryAfter !== null) response.setHeader('retry-after', retryAfter);
      sendJson(response, 429, { error: 'too_many_pin_attempts' });
      return;
    }
    sendJson(response, upstream.status >= 500 ? 503 : 502, {
      error: 'device_bootstrap_failed',
    });
    return;
  }

  let parsed: unknown;
  try {
    parsed = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }
  const source = safeObject(parsed);
  const shop = safeObject(source?.['shop']);
  const worker = safeObject(source?.['worker']);
  if (source === null || shop === null || worker === null) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  const shopId = requiredString(source['shopId']);
  const returnedDeviceId = requiredString(source['deviceId']);
  const accessToken = requiredString(source['accessToken']);
  const refreshToken = requiredString(source['refreshToken']);
  const shopName = requiredString(shop['name']);
  const workerId = requiredString(worker['id']);
  const workerShopId = requiredString(worker['shopId']);
  const workerName = requiredString(worker['displayName']);
  const pinHash = requiredString(worker['pinHash']);
  const rawExpiresAt = source['expiresAt'];
  const expiresAt =
    typeof rawExpiresAt === 'number' && Number.isSafeInteger(rawExpiresAt) && rawExpiresAt > 0
      ? rawExpiresAt
      : null;

  if (
    shopId === null ||
    !UUID_PATTERN.test(shopId) ||
    returnedDeviceId !== deviceId ||
    accessToken === null ||
    refreshToken === null ||
    requiredString(shop['id']) !== shopId ||
    shopName === null ||
    shop['active'] !== true ||
    workerId === null ||
    !UUID_PATTERN.test(workerId) ||
    workerShopId !== shopId ||
    workerName === null ||
    pinHash === null ||
    worker['active'] !== true
  ) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  persistSession(response, { shopId, deviceId, accessToken, refreshToken }, expiresAt);
  sendJson(response, 200, {
    status: 'READY',
    shopId,
    deviceId,
    shop: { id: shopId, name: shopName, active: true },
    worker: {
      id: workerId,
      shopId,
      displayName: workerName,
      pinHash,
      active: true,
    },
  });
}

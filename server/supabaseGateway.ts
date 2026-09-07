import type { IncomingMessage, ServerResponse } from 'node:http';

export type GatewayRequest = IncomingMessage & { readonly body?: unknown };
export type GatewayResponse = ServerResponse;

export interface DeviceSessionSummary {
  readonly shopId: string;
  readonly deviceId: string;
}

interface RefreshableDeviceSession extends DeviceSessionSummary {
  readonly refreshToken: string;
}

export interface DeviceSessionSecrets extends RefreshableDeviceSession {
  readonly accessToken: string;
}

type StoredDeviceSession =
  | { readonly status: 'USABLE'; readonly session: DeviceSessionSecrets }
  | { readonly status: 'REFRESHABLE'; readonly session: RefreshableDeviceSession }
  | { readonly status: 'NOT_ENROLLED' };

export type DeviceSessionResolution =
  | { readonly status: 'VALID'; readonly session: DeviceSessionSecrets }
  | { readonly status: 'NOT_ENROLLED' }
  | { readonly status: 'TRANSPORT_UNAVAILABLE' }
  | { readonly status: 'AUTHORITATIVELY_INVALID' }
  | { readonly status: 'PROTOCOL_ERROR' };

export interface SupabaseServerConfig {
  readonly projectUrl: string;
  readonly publishableKey: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_ACCESS = 'tux_ops_access';
const COOKIE_REFRESH = 'tux_ops_refresh';
const COOKIE_SHOP = 'tux_ops_shop';
const COOKIE_DEVICE = 'tux_ops_device';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_JSON_BODY_BYTES = 1_048_576;

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function serverConfig(): SupabaseServerConfig | null {
  const rawUrl =
    process.env['TUX_SUPABASE_URL']?.trim() ?? process.env['SUPABASE_URL']?.trim() ?? '';
  const publishableKey =
    process.env['TUX_SUPABASE_PUBLISHABLE_KEY']?.trim() ??
    process.env['SUPABASE_PUBLISHABLE_KEY']?.trim() ??
    process.env['SUPABASE_ANON_KEY']?.trim() ??
    '';
  if (rawUrl.length === 0 || publishableKey.length === 0) return null;

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return null;
    return { projectUrl: url.origin, publishableKey };
  } catch {
    return null;
  }
}

export function sendJson(
  response: GatewayResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

export function requireServerConfig(response: GatewayResponse): SupabaseServerConfig | null {
  const config = serverConfig();
  if (config === null) {
    sendJson(response, 503, { error: 'remote_backend_not_configured' });
    return null;
  }
  return config;
}

export function requireSameOrigin(request: GatewayRequest, response: GatewayResponse): boolean {
  const origin = firstHeader(request.headers.origin);
  if (origin.length === 0) return true;

  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = (forwardedHost || firstHeader(request.headers.host)).split(',')[0]?.trim() ?? '';
  if (host.length === 0) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return false;
    }
    const forwardedProto =
      firstHeader(request.headers['x-forwarded-proto']).split(',')[0]?.trim().toLowerCase() ?? '';
    if (forwardedProto.length > 0 && originUrl.protocol !== `${forwardedProto}:`) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return false;
    }
    return true;
  } catch {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
}

function parseCookies(request: GatewayRequest): Readonly<Record<string, string>> {
  const raw = firstHeader(request.headers.cookie);
  const cookies: Record<string, string> = {};
  for (const segment of raw.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name.length === 0) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values rather than surfacing parser details.
    }
  }
  return cookies;
}

function cookie(name: string, value: string, maxAge = COOKIE_MAX_AGE_SECONDS): string {
  return `${name}=${encodeURIComponent(value)}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readDeviceSession(request: GatewayRequest): StoredDeviceSession {
  const cookies = parseCookies(request);
  const shopId = requiredString(cookies[COOKIE_SHOP]);
  const deviceId = requiredString(cookies[COOKIE_DEVICE]);
  const refreshToken = requiredString(cookies[COOKIE_REFRESH]);
  if (
    shopId === null ||
    deviceId === null ||
    refreshToken === null ||
    !UUID_PATTERN.test(shopId) ||
    !UUID_PATTERN.test(deviceId)
  ) {
    return { status: 'NOT_ENROLLED' };
  }

  const accessToken = requiredString(cookies[COOKIE_ACCESS]);
  if (accessToken === null) {
    return { status: 'REFRESHABLE', session: { shopId, deviceId, refreshToken } };
  }
  return { status: 'USABLE', session: { shopId, deviceId, accessToken, refreshToken } };
}

function jwtExpiry(accessToken: string): number | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const parsed: unknown = JSON.parse(
      Buffer.from(normalized + padding, 'base64').toString('utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const exp = (parsed as Record<string, unknown>)['exp'];
    return typeof exp === 'number' && Number.isSafeInteger(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

function persistSession(
  response: GatewayResponse,
  session: DeviceSessionSecrets,
  expiresAt?: number | null,
): void {
  const now = Math.floor(Date.now() / 1000);
  const accessMaxAge =
    typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) && expiresAt > now
      ? Math.max(60, Math.min(COOKIE_MAX_AGE_SECONDS, expiresAt - now))
      : 60 * 60;
  response.setHeader('set-cookie', [
    cookie(COOKIE_ACCESS, session.accessToken, accessMaxAge),
    cookie(COOKIE_REFRESH, session.refreshToken),
    cookie(COOKIE_SHOP, session.shopId),
    cookie(COOKIE_DEVICE, session.deviceId),
  ]);
}

export function clearDeviceSession(response: GatewayResponse): void {
  response.setHeader('set-cookie', [
    clearCookie(COOKIE_ACCESS),
    clearCookie(COOKIE_REFRESH),
    clearCookie(COOKIE_SHOP),
    clearCookie(COOKIE_DEVICE),
  ]);
}

async function refreshDeviceSession(
  config: SupabaseServerConfig,
  session: RefreshableDeviceSession,
  response: GatewayResponse,
): Promise<DeviceSessionResolution> {
  let refreshResponse: Response;
  try {
    refreshResponse = await fetch(`${config.projectUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: 'TRANSPORT_UNAVAILABLE' };
  }

  if (
    refreshResponse.status === 400 ||
    refreshResponse.status === 401 ||
    refreshResponse.status === 403
  ) {
    return { status: 'AUTHORITATIVELY_INVALID' };
  }
  if (!refreshResponse.ok) return { status: 'PROTOCOL_ERROR' };

  let parsed: unknown;
  try {
    parsed = await refreshResponse.json();
  } catch {
    return { status: 'PROTOCOL_ERROR' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'PROTOCOL_ERROR' };
  }
  const source = parsed as Record<string, unknown>;
  const accessToken = requiredString(source['access_token']);
  const refreshToken = requiredString(source['refresh_token']);
  if (accessToken === null || refreshToken === null) return { status: 'PROTOCOL_ERROR' };

  const rawExpiresAt = source['expires_at'];
  const rawExpiresIn = source['expires_in'];
  const expiresAt =
    typeof rawExpiresAt === 'number' && Number.isSafeInteger(rawExpiresAt) && rawExpiresAt > 0
      ? rawExpiresAt
      : typeof rawExpiresIn === 'number' && Number.isSafeInteger(rawExpiresIn) && rawExpiresIn > 0
        ? Math.floor(Date.now() / 1000) + rawExpiresIn
        : jwtExpiry(accessToken);
  if (expiresAt === null) return { status: 'PROTOCOL_ERROR' };

  const refreshed: DeviceSessionSecrets = {
    shopId: session.shopId,
    deviceId: session.deviceId,
    accessToken,
    refreshToken,
  };
  persistSession(response, refreshed, expiresAt);
  return { status: 'VALID', session: refreshed };
}

export async function resolveDeviceSession(
  request: GatewayRequest,
  response: GatewayResponse,
  config: SupabaseServerConfig,
): Promise<DeviceSessionResolution> {
  const storedSession = readDeviceSession(request);
  if (storedSession.status === 'NOT_ENROLLED') return { status: 'NOT_ENROLLED' };
  if (storedSession.status === 'REFRESHABLE') {
    return refreshDeviceSession(config, storedSession.session, response);
  }

  const session = storedSession.session;
  const expiresAt = jwtExpiry(session.accessToken);
  if (expiresAt === null) return { status: 'PROTOCOL_ERROR' };
  if (expiresAt - Math.floor(Date.now() / 1000) > 120) return { status: 'VALID', session };
  return refreshDeviceSession(config, session, response);
}

export function sendDeviceSessionResolutionError(
  response: GatewayResponse,
  resolution: Exclude<DeviceSessionResolution, { readonly status: 'VALID' }>,
): void {
  switch (resolution.status) {
    case 'NOT_ENROLLED':
      sendJson(response, 401, { error: 'device_authentication_required' });
      return;
    case 'TRANSPORT_UNAVAILABLE':
      sendJson(response, 503, { error: 'device_session_unavailable' });
      return;
    case 'AUTHORITATIVELY_INVALID':
      clearDeviceSession(response);
      sendJson(response, 401, { error: 'device_session_invalid' });
      return;
    case 'PROTOCOL_ERROR':
      sendJson(response, 502, { error: 'device_session_protocol_error' });
  }
}

export async function requireDeviceSession(
  request: GatewayRequest,
  response: GatewayResponse,
  config: SupabaseServerConfig,
): Promise<DeviceSessionSecrets | null> {
  const resolution = await resolveDeviceSession(request, response, config);
  if (resolution.status === 'VALID') return resolution.session;
  sendDeviceSessionResolutionError(response, resolution);
  return null;
}

export async function readJsonBody(
  request: GatewayRequest,
): Promise<Readonly<Record<string, unknown>>> {
  let rawBody: unknown = request.body;
  if (rawBody === undefined) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_JSON_BODY_BYTES) throw new Error('request_too_large');
      chunks.push(buffer);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');
  }

  let parsed: unknown;
  if (typeof rawBody === 'string') {
    parsed = JSON.parse(rawBody);
  } else if (Buffer.isBuffer(rawBody)) {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } else {
    parsed = rawBody;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid_json');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

export async function enrollDevice(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const config = requireServerConfig(response);
  if (config === null || !requireSameOrigin(request, response)) return;

  let body: Readonly<Record<string, unknown>>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid_enrollment_request' });
    return;
  }

  const enrollmentCode = requiredString(body['enrollmentCode']);
  const deviceId = requiredString(body['deviceId']);
  const deviceLabel =
    typeof body['deviceLabel'] === 'string' ? body['deviceLabel'].trim().slice(0, 120) : '';
  if (
    enrollmentCode === null ||
    enrollmentCode.length < 32 ||
    deviceId === null ||
    !UUID_PATTERN.test(deviceId)
  ) {
    sendJson(response, 400, { error: 'invalid_enrollment_request' });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.projectUrl}/functions/v1/device-enroll`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enrollmentCode, deviceId, deviceLabel }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  if (!upstream.ok) {
    sendJson(response, upstream.status === 401 ? 401 : 502, { error: 'device_enrollment_failed' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = await upstream.json();
  } catch {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  const source = parsed as Record<string, unknown>;
  const shopId = requiredString(source['shopId']);
  const returnedDeviceId = requiredString(source['deviceId']);
  const accessToken = requiredString(source['accessToken']);
  const refreshToken = requiredString(source['refreshToken']);
  const rawExpiresAt = source['expiresAt'];
  const expiresAt =
    typeof rawExpiresAt === 'number' && Number.isSafeInteger(rawExpiresAt) && rawExpiresAt > 0
      ? rawExpiresAt
      : accessToken === null
        ? null
        : jwtExpiry(accessToken);
  if (
    shopId === null ||
    !UUID_PATTERN.test(shopId) ||
    returnedDeviceId !== deviceId ||
    accessToken === null ||
    refreshToken === null
  ) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  persistSession(response, { shopId, deviceId, accessToken, refreshToken }, expiresAt);
  sendJson(response, 200, { status: 'ENROLLED', shopId, deviceId });
}

async function callSupabaseFunction(
  config: SupabaseServerConfig,
  session: DeviceSessionSecrets,
  functionName: 'operations-config' | 'operations-sync',
  request: GatewayRequest,
  body: string | null,
): Promise<Response> {
  const incomingUrl = new URL(request.url ?? '/', 'https://tux.invalid');
  const target = new URL(`${config.projectUrl}/functions/v1/${functionName}`);
  if (functionName === 'operations-config') target.search = incomingUrl.search;

  return fetch(target, {
    method: functionName === 'operations-config' ? 'GET' : 'POST',
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${session.accessToken}`,
      'x-tux-device-id': session.deviceId,
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === null ? {} : { body }),
    signal: AbortSignal.timeout(10_000),
  });
}

export async function proxyAuthenticatedFunction(
  request: GatewayRequest,
  response: GatewayResponse,
  functionName: 'operations-config' | 'operations-sync',
): Promise<void> {
  const expectedMethod = functionName === 'operations-config' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (expectedMethod === 'POST' && !requireSameOrigin(request, response)) return;

  const config = requireServerConfig(response);
  if (config === null) return;
  let session = await requireDeviceSession(request, response, config);
  if (session === null) return;

  let body: string | null = null;
  if (expectedMethod === 'POST') {
    try {
      body = JSON.stringify(await readJsonBody(request));
    } catch {
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }
  }

  let upstream: Response;
  try {
    upstream = await callSupabaseFunction(config, session, functionName, request, body);
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  if (upstream.status === 401) {
    const refreshed = await refreshDeviceSession(config, session, response);
    if (refreshed.status !== 'VALID') {
      sendDeviceSessionResolutionError(response, refreshed);
      return;
    }
    session = refreshed.session;
    try {
      upstream = await callSupabaseFunction(config, session, functionName, request, body);
    } catch {
      sendJson(response, 503, { error: 'remote_backend_unavailable' });
      return;
    }
  }

  const payload = await upstream.text();
  response.statusCode = upstream.status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(payload.length > 0 ? payload : JSON.stringify({}));
}

export async function getDeviceSession(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  const config = requireServerConfig(response);
  if (config === null) return;

  const resolution = await resolveDeviceSession(request, response, config);
  if (resolution.status === 'NOT_ENROLLED') {
    sendJson(response, 404, { status: 'NOT_ENROLLED' });
    return;
  }
  if (resolution.status !== 'VALID') {
    sendDeviceSessionResolutionError(response, resolution);
    return;
  }
  sendJson(response, 200, {
    status: 'ENROLLED',
    shopId: resolution.session.shopId,
    deviceId: resolution.session.deviceId,
  });
}

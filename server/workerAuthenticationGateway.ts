import {
  readJsonBody,
  requireDeviceSession,
  requireSameOrigin,
  requireServerConfig,
  sendJson,
  type GatewayRequest,
  type GatewayResponse,
} from './supabaseGateway';

export type { GatewayRequest, GatewayResponse } from './supabaseGateway';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function proxyWorkerAuthentication(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!requireSameOrigin(request, response)) return;

  const config = requireServerConfig(response);
  if (config === null) return;
  const session = await requireDeviceSession(request, response, config);
  if (session === null) return;

  let body: Readonly<Record<string, unknown>>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid_worker_auth_request' });
    return;
  }
  const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
  if (!/^\d{4,12}$/.test(pin)) {
    sendJson(response, 400, { error: 'invalid_worker_auth_request' });
    return;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.projectUrl}/functions/v1/worker-auth`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${session.accessToken}`,
        'x-tux-device-id': session.deviceId,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ pin }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  let upstreamBody: Record<string, unknown> | null = null;
  try {
    upstreamBody = object(await upstream.json());
  } catch {
    // Invalid upstream JSON is an authoritative protocol failure, not an offline signal.
  }
  if (upstreamBody === null) {
    sendJson(response, 502, { error: 'invalid_remote_response' });
    return;
  }

  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter !== null && upstream.status === 429) response.setHeader('retry-after', retryAfter);
  sendJson(response, upstream.status, upstreamBody);
}

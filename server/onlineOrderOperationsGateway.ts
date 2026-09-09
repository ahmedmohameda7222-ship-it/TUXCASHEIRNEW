import {
  readJsonBody,
  requireDeviceSession,
  requireSameOrigin,
  requireServerConfig,
  sendJson,
  type GatewayRequest,
  type GatewayResponse,
} from './supabaseGateway';

export async function handleOnlineOrderOperationsGateway(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (request.method === 'POST' && !requireSameOrigin(request, response)) return;

  const config = requireServerConfig(response);
  if (config === null) return;
  const session = await requireDeviceSession(request, response, config);
  if (session === null) return;

  let body: string | undefined;
  if (request.method === 'POST') {
    try {
      body = JSON.stringify(await readJsonBody(request));
    } catch {
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }
  }

  const incomingUrl = new URL(request.url ?? '/', 'https://tux.invalid');
  const target = new URL(`${config.projectUrl}/functions/v1/online-order-operations`);
  if (request.method === 'GET') target.search = incomingUrl.search;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${session.accessToken}`,
        'x-tux-device-id': session.deviceId,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(response, 503, { error: 'remote_backend_unavailable' });
    return;
  }

  const payload = await upstream.text();
  response.statusCode = upstream.status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(payload.length > 0 ? payload : JSON.stringify({}));
}

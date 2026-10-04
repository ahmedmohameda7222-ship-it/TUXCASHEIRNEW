import deviceBootstrap from '../../../api/device-bootstrap';
import deviceEnroll from '../../../api/device-enroll';
import deviceSession from '../../../api/device-session';
import type { GatewayRequest, GatewayResponse } from '../../../server/supabaseGateway';
import { sendJson } from '../../../server/supabaseGateway';

const handlers = {
  'device-bootstrap': deviceBootstrap,
  'device-enroll': deviceEnroll,
  'device-session': deviceSession,
} as const;

type DeviceRoute = keyof typeof handlers;

function routeFromRequest(request: GatewayRequest): string | null {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.searchParams.get('route');
}

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const route = routeFromRequest(request);
  const target = route === null ? undefined : handlers[route as DeviceRoute];

  if (target === undefined) {
    sendJson(response, 404, { error: 'route_not_found' });
    return;
  }

  await target(request, response);
}

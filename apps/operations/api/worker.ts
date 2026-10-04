import workerAuth from '../../../api/worker-auth.js';
import workerMenuLayout from '../../../api/worker-menu-layout.js';
import workerUiPreferences from '../../../api/worker-ui-preferences.js';
import type { GatewayRequest, GatewayResponse } from '../../../server/supabaseGateway.js';
import { sendJson } from '../../../server/supabaseGateway.js';

const handlers = {
  'worker-auth': workerAuth,
  'worker-menu-layout': workerMenuLayout,
  'worker-ui-preferences': workerUiPreferences,
} as const;

type WorkerRoute = keyof typeof handlers;

function routeFromRequest(request: GatewayRequest): string | null {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.searchParams.get('route');
}

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const route = routeFromRequest(request);
  const target = route === null ? undefined : handlers[route as WorkerRoute];

  if (target === undefined) {
    sendJson(response, 404, { error: 'route_not_found' });
    return;
  }

  await target(request, response);
}

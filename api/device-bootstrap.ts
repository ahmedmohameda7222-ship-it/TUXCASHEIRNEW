import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { sendJson } from '../server/supabaseGateway.js';
import { bootstrapDeviceWithWorkerPin } from '../server/workerPinBootstrap.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  await bootstrapDeviceWithWorkerPin(request, response);
}

import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { sendJson } from '../server/supabaseGateway';
import { bootstrapDeviceWithWorkerPin } from '../server/workerPinBootstrap';

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

import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';
import { handleWorkerMenuLayout } from '../server/workerMenuLayoutGateway.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWorkerMenuLayout(request, response);
}

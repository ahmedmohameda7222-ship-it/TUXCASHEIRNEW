import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import { handleWorkerMenuLayout } from '../server/workerMenuLayoutGateway';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWorkerMenuLayout(request, response);
}

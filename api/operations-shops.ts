import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { listOperationsLoginShops } from '../server/operationsShopDirectory.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await listOperationsLoginShops(request, response);
}

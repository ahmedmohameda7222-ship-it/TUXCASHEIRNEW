import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { proxyAuthenticatedFunction } from '../server/supabaseGateway.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await proxyAuthenticatedFunction(request, response, 'operations-order-lifecycle');
}

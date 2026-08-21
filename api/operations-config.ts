import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { proxyAuthenticatedFunction } from '../server/supabaseGateway';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await proxyAuthenticatedFunction(request, response, 'operations-config');
}

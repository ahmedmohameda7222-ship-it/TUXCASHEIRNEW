import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { proxyAuthenticatedFunction } from '../server/supabaseGateway';

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await proxyAuthenticatedFunction(request, response, 'operations-config');
}

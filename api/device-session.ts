import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { getDeviceSession } from '../server/supabaseGateway';

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await getDeviceSession(request, response);
}

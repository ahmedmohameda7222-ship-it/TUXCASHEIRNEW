import { handleOnlineOrderOperationsGateway } from '../server/onlineOrderOperationsGateway';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleOnlineOrderOperationsGateway(request, response);
}

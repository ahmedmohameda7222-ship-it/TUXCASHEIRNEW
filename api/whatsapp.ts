import { handleWhatsAppOperations } from '../server/whatsappOperationsGateway';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWhatsAppOperations(request, response);
}

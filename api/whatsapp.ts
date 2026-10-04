import { handleWhatsAppOperations } from '../server/whatsappOperationsGateway.js';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWhatsAppOperations(request, response);
}

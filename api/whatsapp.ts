import { handleWhatsAppOperations } from '../server/whatsappOperationsGateway.js';
import { handleWhatsAppEventDispatch } from '../server/whatsappEventDispatchHandler.js';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/api/whatsapp', 'https://tux.invalid');
  if (url.searchParams.get('__internalTask') === 'event-dispatch') {
    await handleWhatsAppEventDispatch(request, response);
    return;
  }
  await handleWhatsAppOperations(request, response);
}

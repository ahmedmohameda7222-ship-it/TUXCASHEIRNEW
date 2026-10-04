import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import { handleWorkerUiPreferences } from '../server/workerUiPreferencesGateway';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWorkerUiPreferences(request, response);
}

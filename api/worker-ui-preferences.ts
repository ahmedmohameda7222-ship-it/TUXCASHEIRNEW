import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway.js';
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv.js';
import { handleWorkerUiPreferences } from '../server/workerUiPreferencesGateway.js';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWorkerUiPreferences(request, response);
}

import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { sendJson } from '../server/supabaseGateway';
import {
  handleWhatsAppMediaRetentionRequest,
  runWhatsAppMediaRetention,
  SupabaseWhatsAppMediaRetentionRepository,
} from '../server/whatsappMediaRetention';
import { SupabaseWhatsAppMediaStorage } from '../server/whatsappMediaStorage';
import { loadWhatsAppDataServerConfig } from '../server/whatsappServerConfig';

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await handleWhatsAppMediaRetentionRequest({
    method: request.method,
    authorization: firstHeader(request.headers.authorization),
    cronSecret: process.env['CRON_SECRET'],
    now,
    runRetention: async () => {
      const config = loadWhatsAppDataServerConfig();
      return runWhatsAppMediaRetention({
        repository: new SupabaseWhatsAppMediaRetentionRepository(config),
        storage: new SupabaseWhatsAppMediaStorage(config),
        now,
      });
    },
  });

  for (const [name, value] of Object.entries(result.headers ?? {})) {
    response.setHeader(name, value);
  }
  sendJson(response, result.statusCode, result.body);
}

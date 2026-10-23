import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway.js';
import { sendJson } from './supabaseGateway.js';
import {
  dispatchPendingWhatsAppEventMessages,
  SupabaseWhatsAppEventMessagingRepository,
} from './whatsappEventMessaging.js';
import { createWhatsAppProviderGateway } from './whatsappProviderGateway.js';
import { loadWhatsAppDataServerConfig, loadWhatsAppServerConfig } from './whatsappServerConfig.js';

export interface WhatsAppEventDispatchHandlerDependencies {
  readonly enabled: boolean;
  readonly secret: string | null;
  readonly dispatch: () => Promise<unknown>;
}

function header(request: GatewayRequest, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function authorized(received: string, expected: string): boolean {
  if (expected.length < 32 || received.length === 0) return false;
  const receivedDigest = createHash('sha256').update(received).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

function productionDependencies(
  environment: NodeJS.ProcessEnv = process.env,
): WhatsAppEventDispatchHandlerDependencies {
  const enabled = environment['TUX_WHATSAPP_EVENT_DISPATCH_ENABLED']?.trim() === '1';
  const secret = environment['TUX_WHATSAPP_EVENT_DISPATCH_SECRET']?.trim() ?? null;
  return {
    enabled,
    secret,
    async dispatch() {
      const dataConfig = loadWhatsAppDataServerConfig(environment);
      const providerConfig = loadWhatsAppServerConfig(environment);
      return dispatchPendingWhatsAppEventMessages({
        repository: new SupabaseWhatsAppEventMessagingRepository(dataConfig),
        provider: createWhatsAppProviderGateway({
          graphVersion: providerConfig.graphVersion,
          accessToken: providerConfig.accessToken,
        }),
        workerId: `event-dispatch:${environment['VERCEL_REGION']?.trim() || 'server'}`,
        leaseToken: randomUUID,
      });
    },
  };
}

export async function handleWhatsAppEventDispatch(
  request: GatewayRequest,
  response: GatewayResponse,
  dependencies: WhatsAppEventDispatchHandlerDependencies = productionDependencies(),
): Promise<void> {
  if (!dependencies.enabled) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (dependencies.secret === null || dependencies.secret.length < 32) {
    sendJson(response, 503, { error: 'event_dispatch_not_configured' });
    return;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header(request, 'authorization'));
  if (match === null || !authorized(match[1]!.trim(), dependencies.secret)) {
    sendJson(response, 401, { error: 'event_dispatch_unauthorized' });
    return;
  }
  try {
    const summary = await dependencies.dispatch();
    sendJson(response, 200, { ok: true, summary });
  } catch {
    sendJson(response, 503, { error: 'event_dispatch_unavailable' });
  }
}

import type { IncomingMessage } from 'node:http';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { SupabaseWhatsAppChannelResolver } from '../server/whatsappChannelResolver';
import { createWhatsAppProviderGateway } from '../server/whatsappProviderGateway';
import { loadWhatsAppServerConfig } from '../server/whatsappServerConfig';
import {
  SupabaseWhatsAppInboundMaterializer,
  SupabaseWhatsAppInboundMediaStore,
  handleWhatsAppWebhook,
  type WhatsAppWebhookDiagnostic,
  type WhatsAppWebhookResult,
} from '../server/whatsappWebhook';

const MAX_WHATSAPP_WEBHOOK_BODY_BYTES = 1_048_576;

export async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_WHATSAPP_WEBHOOK_BODY_BYTES) {
      throw new Error('WHATSAPP_WEBHOOK_BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendResult(response: GatewayResponse, result: WhatsAppWebhookResult): void {
  response.statusCode = result.status;
  response.setHeader('content-type', result.contentType);
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(result.body);
}

function sendSafeJson(
  response: GatewayResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  sendResult(response, {
    status,
    body: JSON.stringify(body),
    contentType: 'application/json; charset=utf-8',
  });
}

function diagnosticSink(diagnostic: WhatsAppWebhookDiagnostic): void {
  console.warn(`[whatsapp-webhook] ${diagnostic}`);
}

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  let config;
  try {
    config = loadWhatsAppServerConfig();
  } catch {
    sendSafeJson(response, 503, { error: 'whatsapp_backend_not_configured' });
    return;
  }

  let rawBody: Buffer = Buffer.alloc(0);
  if (request.method === 'POST') {
    try {
      rawBody = await readRawBody(request);
    } catch (error) {
      if (error instanceof Error && error.message === 'WHATSAPP_WEBHOOK_BODY_TOO_LARGE') {
        sendSafeJson(response, 413, { error: 'webhook_body_too_large' });
        return;
      }
      sendSafeJson(response, 400, { error: 'webhook_body_unreadable' });
      return;
    }
  }

  const dataConfig = {
    projectUrl: config.projectUrl,
    serviceRoleKey: config.serviceRoleKey,
  };
  const channelResolver = new SupabaseWhatsAppChannelResolver(dataConfig);
  const materializer = new SupabaseWhatsAppInboundMaterializer(dataConfig);
  const providerGateway = createWhatsAppProviderGateway({
    graphVersion: config.graphVersion,
    accessToken: config.accessToken,
  });
  const mediaStore = new SupabaseWhatsAppInboundMediaStore(dataConfig);

  const result = await handleWhatsAppWebhook(
    {
      method: request.method,
      url: request.url ?? '/api/whatsapp-webhook',
      headers: request.headers,
      rawBody,
    },
    {
      appSecret: config.appSecret,
      webhookVerifyToken: config.webhookVerifyToken,
      channelResolver,
      materializer,
      providerGateway,
      mediaStore,
      diagnosticSink,
    },
  );

  sendResult(response, result);
}

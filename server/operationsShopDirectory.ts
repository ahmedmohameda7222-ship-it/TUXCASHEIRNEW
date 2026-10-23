import { createHmac, randomUUID } from 'node:crypto';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway.js';
import { requireSameOrigin, requireServerConfig, sendJson } from './supabaseGateway.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function listOperationsLoginShops(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!requireSameOrigin(request, response)) return;
  const config = requireServerConfig(response);
  if (config === null) return;
  const secret = process.env['TUX_BOOTSTRAP_HMAC_SECRET']?.trim() ?? '';
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    sendJson(response, 503, { error: 'shop_directory_unavailable' });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const signature = createHmac('sha256', secret)
    .update(JSON.stringify(['tux-operations-shop-directory:v1', timestamp, nonce]))
    .digest('hex');
  let upstream: Response;
  try {
    upstream = await fetch(`${config.projectUrl}/functions/v1/device-bootstrap`, {
      method: 'GET',
      headers: {
        apikey: config.publishableKey,
        'x-tux-bootstrap-timestamp': String(timestamp),
        'x-tux-bootstrap-nonce': nonce,
        'x-tux-bootstrap-signature': signature,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    sendJson(response, 503, { error: 'shop_directory_unavailable' });
    return;
  }
  if (!upstream.ok) {
    sendJson(response, 503, { error: 'shop_directory_unavailable' });
    return;
  }

  try {
    const parsed: unknown = await upstream.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    const rows = (parsed as { shops?: unknown }).shops;
    if (!Array.isArray(rows) || rows.length > 200) throw new Error();
    const shops = rows.map((value: unknown) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      if (
        typeof row['id'] !== 'string' ||
        !UUID_PATTERN.test(row['id']) ||
        typeof row['name'] !== 'string' ||
        row['name'].trim().length === 0 ||
        row['name'].length > 200
      )
        throw new Error();
      return { id: row['id'], name: row['name'] };
    });
    sendJson(response, 200, { shops });
  } catch {
    sendJson(response, 502, { error: 'invalid_shop_directory_response' });
  }
}

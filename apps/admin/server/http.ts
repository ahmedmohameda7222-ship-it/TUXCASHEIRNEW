import type { IncomingMessage, ServerResponse } from 'node:http';

export type AdminRequest = IncomingMessage & { readonly body?: unknown };
export type AdminResponse = ServerResponse;

const MAX_JSON_BYTES = 64 * 1024;

export function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function sendJson(
  response: AdminResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

export function requireSameOrigin(request: AdminRequest, response: AdminResponse): boolean {
  const origin = firstHeader(request.headers.origin).trim();
  if (!origin) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = (forwardedHost || firstHeader(request.headers.host)).split(',')[0]?.trim() ?? '';
  if (!host) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) throw new Error('host_mismatch');
    const proto = firstHeader(request.headers['x-forwarded-proto'])
      .split(',')[0]
      ?.trim()
      .toLowerCase();
    if (proto && originUrl.protocol !== `${proto}:`) throw new Error('protocol_mismatch');
    return true;
  } catch {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
}

export async function readJsonObject(request: AdminRequest): Promise<Record<string, unknown>> {
  if (request.body !== undefined) {
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
      throw new Error('invalid_json_body');
    }
    return request.body as Record<string, unknown>;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BYTES) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid_json_body');
  }
  return parsed as Record<string, unknown>;
}

export function clientFingerprint(request: AdminRequest): { ip: string; userAgent: string } {
  const forwarded = firstHeader(request.headers['x-forwarded-for']).split(',')[0]?.trim();
  return {
    ip: forwarded || request.socket.remoteAddress || 'unknown',
    userAgent: firstHeader(request.headers['user-agent']).trim(),
  };
}

export function shouldUseSecureCookie(request: AdminRequest): boolean {
  if (process.env['NODE_ENV'] === 'production') return true;
  const proto = firstHeader(request.headers['x-forwarded-proto'])
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  return proto === 'https';
}

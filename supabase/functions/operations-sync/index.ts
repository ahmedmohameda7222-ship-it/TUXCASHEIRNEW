import { createClient } from '@supabase/supabase-js';
import { buildRemoteMaterializationPlanV1 } from '@tux/remote-materializer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type, x-tux-device-id',
  'access-control-allow-methods': 'POST, OPTIONS',
} as const;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`)
    .join(',')}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.length === 0 ? null : token;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse();
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token === null || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'receiver_not_configured' });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(401, { error: 'invalid_access_token' });
  }

  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  let plan;
  try {
    // This call runs the canonical V1 deep parser before any remote mutation is planned.
    plan = buildRemoteMaterializationPlanV1(envelope);
  } catch (cause) {
    return jsonResponse(400, {
      error: 'invalid_operations_sync_envelope',
      message: cause instanceof Error ? cause.message : 'Operations sync validation failed.',
    });
  }

  const payloadSha256 = await sha256Hex(stableJson(envelope));
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await serviceClient.rpc('ingest_tux_operations_materialization_v1', {
    p_auth_user_id: userData.user.id,
    p_device_id: deviceId,
    p_envelope: envelope,
    p_payload_sha256: payloadSha256,
    p_plan: plan,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
      return jsonResponse(403, { error: 'device_not_authorized' });
    }
    if (message.includes('TUX_PROTOCOL_CONFLICT')) {
      return jsonResponse(409, { error: 'sync_protocol_conflict' });
    }
    if (message.includes('TUX_DEPENDENCY_MISSING')) {
      return jsonResponse(425, { error: 'sync_dependency_not_ready' });
    }
    if (message.includes('TUX_SYNC_') || message.includes('TUX_CONFIGURATION_')) {
      return jsonResponse(400, { error: 'invalid_materialization_plan' });
    }
    console.error('operations-sync RPC failed', error);
    return jsonResponse(500, { error: 'remote_materialization_failed' });
  }

  return jsonResponse(200, { status: data === 'REPLAY' ? 'REPLAY' : 'APPLIED' });
});

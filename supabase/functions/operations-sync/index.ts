import { createClient } from '@supabase/supabase-js';
import { buildRemoteMaterializationPlanV1 } from '@tux/remote-materializer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
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
  if (request.method !== 'POST' && request.method !== 'GET') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

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

  if (request.method === 'GET') {
    const reader = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await reader.rpc('read_tux_operations_open_business_day_v1', {
      p_auth_user_id: userData.user.id,
      p_device_id: deviceId,
    });
    if (error) {
      if (error.message?.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
        return jsonResponse(403, { error: 'device_not_authorized' });
      }
      console.error('operations-sync canonical business day read failed', error);
      return jsonResponse(503, { error: 'canonical_business_day_unavailable' });
    }
    return jsonResponse(200, {
      shopId: data.shopId,
      openDayId: data.openDayId ?? null,
      openDay: data.openDay ?? null,
      openWorkerCount: data.openWorkerCount ?? 0,
    });
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
    // A mismatched OPEN identity is a blocked dependency, not a transient generic 500.
    // Keep the immutable local event in the outbox so the origin can deliver End Day first.
    const openConflict = message.match(/TUX_BUSINESS_DAY_OPEN_CONFLICT:([0-9a-f-]{36})/i);
    if (openConflict || (error.code === '23505' && message.includes('business_days_one_open_per_shop_idx'))) {
      return jsonResponse(423, {
        error: 'business_day_open_conflict',
        canonicalDayId: openConflict?.[1] ?? null,
        recovery: 'sync_origin_end_day_before_starting_another_day',
      });
    }
    const missingDay = message.match(/TUX_BUSINESS_DAY_DEPENDENCY_MISSING:([0-9a-f-]{36})/i);
    if (missingDay || (error.code === '23503' &&
       (message.includes('worker_sessions_business_day_id_fkey') ||
        message.includes('worker_sessions_day_same_shop_fk') ||
        message.includes('orders_business_day_id_fkey')))) {
      return jsonResponse(425, {
        error: 'business_day_dependency_not_ready',
        missingDayId: missingDay?.[1] ?? null,
        recovery: 'deliver_original_business_day_started_event_first',
      });
    }
    if (message.includes('TUX_BUSINESS_DAY_SHOP_CONFLICT') ||
        message.includes('TUX_BUSINESS_DAY_REOPEN_FORBIDDEN') ||
        message.includes('TUX_BUSINESS_DAY_ALREADY_CLOSED')) {
      return jsonResponse(409, { error: 'business_day_identity_conflict' });
    }
    if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
      return jsonResponse(403, { error: 'device_not_authorized' });
    }
    if (message.includes('TUX_PROTOCOL_CONFLICT')) {
      return jsonResponse(409, { error: 'sync_protocol_conflict' });
    }
    const stale = message.match(/TUX_ORDER_STALE_OPERATIONAL_REVISION:([A-Z_]+):(-?\d+)/);
    if (stale) {
      return jsonResponse(409, {
        error: 'stale_operational_revision',
        canonicalStatus: stale[1],
        canonicalOperationalRevision: Number(stale[2]),
      });
    }
    if (message.includes('TUX_DEPENDENCY_MISSING')) {
      return jsonResponse(425, { error: 'sync_dependency_not_ready' });
    }
    if (message.includes('TUX_INVENTORY_INSUFFICIENT_STOCK')) {
      return jsonResponse(422, { error: 'inventory_reservation_rejected' });
    }
    if (
      message.includes('TUX_SYNC_') ||
      message.includes('TUX_CONFIGURATION_') ||
      message.includes('TUX_INVENTORY_PLACEMENT_REQUIREMENTS_MISMATCH') ||
      message.includes('TUX_INVENTORY_TERMINAL_SETTLEMENT_MISMATCH') ||
      message.includes('TUX_INVENTORY_RESERVATION_NOT_SETTLED') ||
      message.includes('TUX_INVENTORY_UNDO_REVERSAL_MISMATCH') ||
      message.includes('TUX_INVENTORY_BULK_UNDO_MISMATCH') ||
      message.includes('TUX_INVENTORY_CANCEL_RESTOCK_MISMATCH') ||
      message.includes('TUX_ORDER_TRANSITION_PRECONDITION_MISMATCH')
    ) {
      return jsonResponse(400, { error: 'invalid_materialization_plan' });
    }
    console.error('operations-sync RPC failed', error);
    return jsonResponse(500, { error: 'remote_materialization_failed' });
  }

  return jsonResponse(200, { status: data === 'REPLAY' ? 'REPLAY' : 'APPLIED' });
});

import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token.length === 0 || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  const action = body['action'];
  const businessDayId = body['businessDayId'];
  const workerSessionId = body['workerSessionId'];
  if (
    (action !== 'HEARTBEAT' && action !== 'PREPARE_EXIT') ||
    typeof businessDayId !== 'string' ||
    !UUID_PATTERN.test(businessDayId) ||
    typeof workerSessionId !== 'string' ||
    !UUID_PATTERN.test(workerSessionId)
  ) {
    return jsonResponse(400, { error: 'invalid_session_exit_request' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'session_exit_not_configured' });
  }
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(401, { error: 'invalid_access_token' });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpcName =
    action === 'HEARTBEAT'
      ? 'touch_tux_operations_worker_session_v1'
      : 'prepare_tux_operations_worker_exit_v1';
  const { data, error } = await serviceClient.rpc(rpcName, {
    p_auth_user_id: userData.user.id,
    p_device_id: deviceId,
    p_business_day_id: businessDayId,
    p_worker_session_id: workerSessionId,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
      return jsonResponse(403, { error: 'device_not_authorized' });
    }
    if (message.includes('TUX_WORKER_SESSION_DEVICE_CONFLICT')) {
      return jsonResponse(409, { error: 'worker_session_device_conflict' });
    }
    if (
      message.includes('TUX_WORKER_SESSION_NOT_ACTIVE') ||
      message.includes('TUX_BUSINESS_DAY_NOT_OPEN')
    ) {
      return jsonResponse(409, { error: 'worker_session_not_active' });
    }
    console.error('operations session exit RPC failed', error);
    return jsonResponse(503, { error: 'session_exit_unavailable' });
  }
  return jsonResponse(200, data);
});

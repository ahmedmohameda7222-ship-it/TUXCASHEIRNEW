import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 250;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.length === 0 ? null : token;
}

function cursorSequence(value: string | null): number {
  if (value === null) return 0;
  if (!/^[0-9]+$/.test(value)) throw new TypeError('invalid cursor');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError('invalid cursor');
  return parsed;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return parsed;
}

Deno.serve(async (request) => {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token === null || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get('shopId')?.trim() ?? '';
  if (!UUID_PATTERN.test(shopId)) return jsonResponse(400, { error: 'invalid_shop_id' });

  let cursor = 0;
  try {
    cursor = cursorSequence(url.searchParams.get('cursor'));
  } catch {
    return jsonResponse(400, { error: 'invalid_order_lifecycle_cursor' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'order_lifecycle_feed_not_configured' });
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
  const { data, error } = await serviceClient.rpc('read_order_lifecycle_feed_v1', {
    p_auth_user_id: userData.user.id,
    p_device_id: deviceId,
    p_shop_id: shopId,
    p_after_sequence: cursor,
    p_limit: PAGE_SIZE + 1,
  });
  if (error) {
    const message = String(error.message ?? '');
    if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
      return jsonResponse(403, { error: 'device_not_authorized' });
    }
    if (message.includes('TUX_ORDER_LIFECYCLE_FEED_REQUEST_INVALID')) {
      return jsonResponse(400, { error: 'invalid_order_lifecycle_request' });
    }
    console.error('order lifecycle feed lookup failed', error);
    return jsonResponse(500, { error: 'order_lifecycle_feed_lookup_failed' });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  try {
    const events = pageRows.map((row) => {
      const reasonId = row['reason_code_id'];
      const reason =
        reasonId === null || reasonId === undefined
          ? null
          : {
              id: String(reasonId),
              key: String(row['reason_code_key']),
              label: String(row['reason_label_snapshot']),
              family: String(row['reason_family_snapshot']),
              version: integer(row['reason_config_version'], 'Reason version'),
              scope: String(row['reason_scope']),
            };
      return {
        sequence: integer(row['sequence'], 'Lifecycle sequence'),
        orderId: String(row['order_id']),
        operationalRevision: integer(
          row['operational_revision'],
          'Lifecycle operational revision',
        ),
        status: String(row['status']),
        eventType: String(row['event_type']),
        occurredAt: String(row['created_at']),
        workerId: row['worker_id'] === null ? null : String(row['worker_id']),
        workerName:
          row['worker_name_snapshot'] === null ? null : String(row['worker_name_snapshot']),
        adminEmployeeId:
          row['admin_employee_id'] === null ? null : String(row['admin_employee_id']),
        foodPrepared: row['food_prepared'] === null ? null : row['food_prepared'] === true,
        stockRestored: row['restore_stock'] === null ? null : row['restore_stock'] === true,
        reason,
        reasonLabel: row['reason'] === null ? null : String(row['reason']),
        note: row['note'] === null ? null : String(row['note']),
      };
    });
    const last = pageRows.at(-1);
    return jsonResponse(200, {
      shopId,
      events,
      nextCursor: last === undefined ? (cursor === 0 ? null : String(cursor)) : String(last['sequence']),
      hasMore,
    });
  } catch (cause) {
    console.error('order lifecycle feed normalization failed', cause);
    return jsonResponse(500, { error: 'order_lifecycle_feed_protocol_error' });
  }
});

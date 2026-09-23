import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 250;
const PROJECTION_PAGE_SIZE = 10_000;

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

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be a safe integer.`);
  return parsed;
}

function finite(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return parsed;
}

function cursorSequence(value: string | null): number {
  if (value === null || !/^[0-9]+$/.test(value)) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError('Inventory cursor is invalid.');
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
    return jsonResponse(400, { error: 'invalid_inventory_cursor' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'inventory_feed_not_configured' });
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

  const [membershipResult, deviceResult] = await Promise.all([
    serviceClient
      .from('shop_memberships')
      .select('shop_id')
      .eq('shop_id', shopId)
      .eq('auth_user_id', userData.user.id)
      .eq('role', 'OPERATIONS_DEVICE')
      .eq('active', true)
      .maybeSingle(),
    serviceClient
      .from('devices')
      .select('id,shop_id')
      .eq('id', deviceId)
      .eq('shop_id', shopId)
      .eq('auth_user_id', userData.user.id)
      .eq('active', true)
      .maybeSingle(),
  ]);
  if (membershipResult.error || deviceResult.error) {
    console.error(
      'inventory feed device authorization lookup failed',
      membershipResult.error ?? deviceResult.error,
    );
    return jsonResponse(500, { error: 'device_authorization_lookup_failed' });
  }
  if (!membershipResult.data || !deviceResult.data) {
    return jsonResponse(403, { error: 'device_not_authorized' });
  }

  async function loadAllInventoryItems() {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await serviceClient
        .from('inventory_items')
        .select('id,shop_id,name,unit_label,tracking_mode,active')
        .eq('shop_id', shopId)
        .order('id', { ascending: true })
        .range(offset, offset + PROJECTION_PAGE_SIZE - 1);
      if (error) return { data: null, error };
      const page = (data ?? []) as Record<string, unknown>[];
      if (page.length === 0) return { data: rows, error: null };
      rows.push(...page);
      offset += page.length;
    }
  }

  async function loadAllInventoryCosts() {
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await serviceClient
        .from('inventory_cost_state')
        .select('inventory_item_id,weighted_unit_cost_minor')
        .eq('shop_id', shopId)
        .order('inventory_item_id', { ascending: true })
        .range(offset, offset + PROJECTION_PAGE_SIZE - 1);
      if (error) return { data: null, error };
      const page = (data ?? []) as Record<string, unknown>[];
      if (page.length === 0) return { data: rows, error: null };
      rows.push(...page);
      offset += page.length;
    }
  }

  const [feedResult, itemsResult, costsResult] = await Promise.all([
    serviceClient
      .from('inventory_movement_feed')
      .select('sequence,movement_id')
      .eq('shop_id', shopId)
      .gt('sequence', cursor)
      .order('sequence', { ascending: true })
      .limit(PAGE_SIZE + 1),
    loadAllInventoryItems(),
    loadAllInventoryCosts(),
  ]);

  if (feedResult.error || itemsResult.error || costsResult.error) {
    console.error(
      'inventory feed lookup failed',
      feedResult.error ?? itemsResult.error ?? costsResult.error,
    );
    return jsonResponse(500, { error: 'inventory_feed_lookup_failed' });
  }

  const feedRows = feedResult.data ?? [];
  const hasMore = feedRows.length > PAGE_SIZE;
  const pageRows = feedRows.slice(0, PAGE_SIZE);
  const movementIds = pageRows.map((row) => String(row.movement_id));

  let movementRows: Record<string, unknown>[] = [];
  if (movementIds.length > 0) {
    const { data, error } = await serviceClient
      .from('inventory_movements')
      .select(
        'id,shop_id,business_day_id,inventory_item_id,movement_type,quantity_delta_micros,reserved_delta_micros,idempotency_key,worker_id,unit_cost_minor,order_id,created_at,compensates_movement_id',
      )
      .in('id', movementIds);
    if (error) {
      console.error('inventory movement feed lookup failed', error);
      return jsonResponse(500, { error: 'inventory_movement_lookup_failed' });
    }
    movementRows = (data ?? []) as Record<string, unknown>[];
  }

  const movementById = new Map(movementRows.map((row) => [String(row['id']), row]));
  const movements: Record<string, unknown>[] = [];
  try {
    for (const feedRow of pageRows) {
      const id = String(feedRow.movement_id);
      const row = movementById.get(id);
      if (row === undefined) throw new Error(`Inventory feed movement ${id} is missing.`);
      movements.push({
        id,
        shopId: String(row['shop_id']),
        businessDayId: row['business_day_id'] === null ? null : String(row['business_day_id']),
        itemId: String(row['inventory_item_id']),
        movementType: String(row['movement_type']),
        quantityDeltaMicros: integer(row['quantity_delta_micros'], 'Inventory quantity delta'),
        reservedDeltaMicros: integer(row['reserved_delta_micros'] ?? 0, 'Inventory reserved delta'),
        idempotencyKey: String(row['idempotency_key']),
        workerId: row['worker_id'] === null ? null : String(row['worker_id']),
        unitCostMinor:
          row['unit_cost_minor'] === null
            ? null
            : finite(row['unit_cost_minor'], 'Inventory movement unit cost'),
        orderId: row['order_id'] === null ? null : String(row['order_id']),
        createdAt: String(row['created_at']),
        compensatesMovementId:
          row['compensates_movement_id'] === null
            ? null
            : String(row['compensates_movement_id']),
      });
    }

    const items = (itemsResult.data ?? []).map((row) => ({
      id: String(row.id),
      shopId: String(row.shop_id),
      name: String(row.name),
      unitLabel: String(row.unit_label),
      trackingMode: String(row.tracking_mode),
      active: row.active === true,
    }));
    const costs = (costsResult.data ?? []).map((row) => ({
      itemId: String(row.inventory_item_id),
      weightedUnitCostMinor: finite(row.weighted_unit_cost_minor, 'Inventory weighted cost'),
    }));
    const last = pageRows.at(-1);
    return jsonResponse(200, {
      shopId,
      items,
      movements,
      costs,
      nextCursor: last === undefined ? (cursor === 0 ? null : String(cursor)) : String(last.sequence),
      hasMore,
    });
  } catch (cause) {
    console.error('inventory feed normalization failed', cause);
    return jsonResponse(500, { error: 'inventory_feed_protocol_error' });
  }
});
